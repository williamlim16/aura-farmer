import { extractRequirements } from "~/lib/postings/extract";
import type { PostingDraft } from "~/lib/postings/types";
import { fetchPosting, PostingNotFoundError } from "./providers";
import { RateLimiter } from "./rate-limit";
import { FetchBlockedError, type SafeFetchOptions } from "./safe-fetch";
import { parsePostingUrl } from "./url";

const g = globalThis as unknown as { __afPostingLimiter?: RateLimiter };
export const postingLimiter = (g.__afPostingLimiter ??= new RateLimiter(10, 60_000));

export type IntakeResult = { ok: true; draft: PostingDraft } | { ok: false; status: number; error: string; code: string };

/** Preview a posting from a URL (not saved). */
export async function previewFromUrl(userId: string, url: string, o: SafeFetchOptions & { limiter?: RateLimiter } = {}): Promise<IntakeResult> {
  const parsed = parsePostingUrl(url);
  if (!parsed.ok) return { ok: false, status: 422, error: parsed.reason, code: "unsupported_url" };
  if (!(o.limiter ?? postingLimiter).take(userId)) return { ok: false, status: 429, error: "Too many imports in a short time. Wait a minute and try again.", code: "rate_limited" };
  try {
    const draft = await fetchPosting(parsed, o);
    if (!draft.title || draft.description.length < 40) return { ok: false, status: 422, error: "The posting had no readable description. Paste it manually instead.", code: "empty_posting" };
    return { ok: true, draft };
  } catch (e) {
    if (e instanceof PostingNotFoundError) return { ok: false, status: 404, error: e.message, code: "not_found" };
    if (e instanceof FetchBlockedError) return { ok: false, status: e.code === "http_error" && e.status === 404 ? 404 : 502, error: `${e.message} You can paste the description manually.`, code: e.code };
    return { ok: false, status: 502, error: "The posting could not be read. You can paste the description manually.", code: "parse_error" };
  }
}

/** Manual fallback: the user pasted a description. */
export function draftFromManual(input: { title: string; company: string; location?: string; description: string; url?: string | null }): PostingDraft {
  const description = input.description.replace(/\r\n?/g, "\n").trim().slice(0, 50_000);
  return {
    source: "manual",
    sourceUrl: input.url ?? null,
    externalId: null,
    title: input.title.trim().slice(0, 300),
    company: input.company.trim().slice(0, 200),
    location: (input.location ?? "").trim().slice(0, 200),
    description,
    requirements: extractRequirements(description),
    retrieval: "manual",
  };
}
