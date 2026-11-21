/**
 * Read-only public job-board APIs (documented, no auth). Never calls any
 * application/submission endpoint.
 *   Greenhouse Job Board API: GET boards-api.greenhouse.io/v1/boards/{board}/jobs/{id}
 *   Lever Postings API:       GET api.lever.co/v0/postings/{site}/{id}?mode=json
 *   Ashby Posting API:        GET api.ashbyhq.com/posting-api/job-board/{board}
 * Endpoint choices follow career-ops providers/{greenhouse,lever,ashby}.mjs.
 */
import { extractRequirements, htmlToText } from "~/lib/postings/extract";
import type { PostingDraft } from "~/lib/postings/types";
import { safeFetchJson, type SafeFetchOptions } from "./safe-fetch";
import type { ParsedPostingUrl } from "./url";

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const prettySlug = (s: string) => s.replace(/[-_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

function finish(d: Omit<PostingDraft, "requirements" | "retrieval">): PostingDraft {
  return { ...d, title: d.title.slice(0, 300), company: d.company.slice(0, 200), location: d.location.slice(0, 200), requirements: extractRequirements(d.description), retrieval: "live_api" };
}

export class PostingNotFoundError extends Error {}

export async function fetchPosting(p: Extract<ParsedPostingUrl, { ok: true }>, o: SafeFetchOptions = {}): Promise<PostingDraft> {
  if (p.source === "greenhouse") {
    const j = (await safeFetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(p.board)}/jobs/${p.jobId}`, o)) as Obj;
    return finish({
      source: "greenhouse",
      sourceUrl: str(j.absolute_url) || p.canonical,
      externalId: `${p.board}:${p.jobId}`,
      title: str(j.title),
      company: str(j.company_name) || prettySlug(p.board),
      location: str((j.location as Obj | undefined)?.name),
      description: htmlToText(str(j.content)),
    });
  }
  if (p.source === "lever") {
    const host = p.region === "eu" ? "api.eu.lever.co" : "api.lever.co";
    const j = (await safeFetchJson(`https://${host}/v0/postings/${encodeURIComponent(p.site)}/${p.postingId}?mode=json`, o)) as Obj;
    const lists = Array.isArray(j.lists) ? (j.lists as Obj[]) : [];
    const body = [str(j.descriptionPlain) || htmlToText(str(j.description)), ...lists.map((l) => `\n${str(l.text)}\n${htmlToText(str(l.content))}`), str(j.additionalPlain) || htmlToText(str(j.additional))].join("\n");
    const cats = (j.categories as Obj | undefined) ?? {};
    return finish({ source: "lever", sourceUrl: str(j.hostedUrl) || p.canonical, externalId: `${p.site}:${p.postingId}`, title: str(j.text), company: prettySlug(p.site), location: str(cats.location), description: body.trim().slice(0, 50_000) });
  }
  // Ashby only offers a whole-board read; large boards (hundreds of postings) need a bigger, still bounded, cap.
  const board = (await safeFetchJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(p.board)}`, { maxBytes: 40 * 1024 * 1024, ...o })) as Obj;
  const jobs = Array.isArray(board.jobs) ? (board.jobs as Obj[]) : [];
  const j = jobs.find((x) => str(x.id).toLowerCase() === p.postingId.toLowerCase());
  if (!j) throw new PostingNotFoundError("That Ashby posting is not on the company's public job board (it may have closed).");
  return finish({ source: "ashby", sourceUrl: str(j.jobUrl) || p.canonical, externalId: `${p.board}:${p.postingId}`, title: str(j.title), company: prettySlug(p.board), location: str(j.location), description: str(j.descriptionPlain) || htmlToText(str(j.descriptionHtml)) });
}
