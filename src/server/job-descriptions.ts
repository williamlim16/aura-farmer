/**
 * Fetch the full description of individual job postings.
 *
 * - Seek and LinkedIn serve the description in the page HTML, so they're
 *   fetched directly (fast, and costs no Tavily credits). LinkedIn's guest
 *   endpoint returns just the posting, without the rest of the page.
 * - Indeed blocks direct requests (401), so it goes through Tavily Extract.
 *   Its `viewjob?jk=` URL can't be fetched there either, but the
 *   `rc/clk?jk=` redirect URL from the search page can. For postings not
 *   hosted on Indeed, that URL redirects to the employer's own careers site,
 *   so there's a best-effort fallback for arbitrary pages.
 *
 * Descriptions are returned as plain text: paragraphs separated by blank
 * lines, list items as "• " lines.
 */

import { titleMatchesKeyword, type JobSource } from "~/server/job-boards";
import { extractPages } from "~/server/tavily";

export interface DescriptionTarget {
  id: number;
  source: string;
  url: string;
  title: string;
}

/**
 * - `found`: got the description.
 * - `missing`: the page loaded but has no description (e.g. the posting
 *   expired) — not worth retrying.
 * - `failed`: blocked / network error — worth retrying later.
 */
export type DescriptionResult =
  | { status: "found"; description: string }
  | { status: "missing" }
  | { status: "failed" };

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/** Parallel direct fetches. LinkedIn starts answering 429 above ~3. */
const DIRECT_CONCURRENCY = 3;
/** Attempts per page when a board answers 429 / 5xx. */
const DIRECT_ATTEMPTS = 3;
/** Tavily Extract accepts at most 20 URLs per request. */
const TAVILY_BATCH = 20;
/** Long descriptions are cut here so a few huge postings don't bloat the page. */
const MAX_LENGTH = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchDescriptions(
  targets: DescriptionTarget[],
): Promise<Map<number, DescriptionResult>> {
  const results = new Map<number, DescriptionResult>();
  const indeed = targets.filter(
    (t) => t.source === ("indeed" satisfies JobSource),
  );
  const direct = targets.filter((t) => t.source !== "indeed");

  await Promise.all([
    fetchViaTavily(indeed, results),
    mapLimit(direct, DIRECT_CONCURRENCY, async (t) => {
      results.set(t.id, await fetchDirect(t));
    }),
  ]);
  return results;
}

// ---------------------------------------------------------------------------
// Seek / LinkedIn — direct HTML fetch

const HTML_MARKERS: Record<string, string> = {
  seek: 'data-automation="jobAdDetails"',
  linkedin: "show-more-less-html__markup",
};

function directUrl({ source, url }: DescriptionTarget): string {
  // https://www.linkedin.com/jobs/view/123 → …/jobs-guest/jobs/api/jobPosting/123
  return source === "linkedin"
    ? url.replace("/jobs/view/", "/jobs-guest/jobs/api/jobPosting/")
    : url;
}

async function fetchDirect(
  target: DescriptionTarget,
): Promise<DescriptionResult> {
  const marker = HTML_MARKERS[target.source];
  if (!marker) return { status: "missing" };

  for (let attempt = 1; attempt <= DIRECT_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(directUrl(target), {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": "en-AU,en;q=0.9",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404 || res.status === 410)
        return { status: "missing" };
      if (res.ok) {
        const inner = elementInnerHtml(await res.text(), marker);
        const text = inner ? htmlToText(inner) : "";
        return text
          ? { status: "found", description: text }
          : { status: "missing" };
      }
      if (res.status !== 429 && res.status < 500) return { status: "failed" };
    } catch {
      // Network error / timeout — retry.
    }
    if (attempt < DIRECT_ATTEMPTS)
      await sleep(1_000 * attempt + Math.random() * 500);
  }
  return { status: "failed" };
}

/**
 * Inner HTML of the element whose opening tag contains `marker`, matching
 * nested tags of the same name so the right closing tag is found.
 */
function elementInnerHtml(html: string, marker: string): string | null {
  const at = html.indexOf(marker);
  if (at === -1) return null;
  const tagStart = html.lastIndexOf("<", at);
  const tag = /^<([a-z][a-z0-9]*)/i.exec(html.slice(tagStart))?.[1];
  const start = html.indexOf(">", at) + 1;
  if (!tag || start === 0) return null;

  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = start;
  let depth = 1;
  for (let m; (m = re.exec(html));) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index);
  }
  return html.slice(start);
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  bull: "•",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, code: string) => {
      if (code.startsWith("#")) {
        const n =
          code[1] === "x" || code[1] === "X"
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    },
  );
}

export function htmlToText(html: string): string {
  return tidy(
    decodeEntities(
      html
        .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<li\b[^>]*>/gi, "\n• ")
        .replace(
          /<\/?(p|div|ul|ol|li|h[1-6]|section|table|tr)\b[^>]*>/gi,
          "\n\n",
        )
        .replace(/<[^>]+>/g, ""),
    ),
  );
}

/** Trim lines, collapse runs of spaces / blank lines, keep bullets tight. */
function tidy(text: string): string {
  const out = text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/^• *$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    // No blank line between consecutive bullets.
    .replace(/^(• [^\n]*)\n\n(?=• )/gm, "$1\n")
    .trim();
  return out.length > MAX_LENGTH
    ? `${out.slice(0, MAX_LENGTH).trimEnd()}…`
    : out;
}

// ---------------------------------------------------------------------------
// Indeed — Tavily Extract

const indeedJk = (url: string) => /[?&]jk=([0-9a-f]+)/i.exec(url)?.[1] ?? null;

async function fetchViaTavily(
  targets: DescriptionTarget[],
  results: Map<number, DescriptionResult>,
) {
  const batches: DescriptionTarget[][] = [];
  for (let i = 0; i < targets.length; i += TAVILY_BATCH) {
    batches.push(targets.slice(i, i + TAVILY_BATCH));
  }
  // Each extract takes ~15s, so run the batches side by side.
  await Promise.all(batches.map((batch) => fetchIndeedBatch(batch, results)));
}

async function fetchIndeedBatch(
  batch: DescriptionTarget[],
  results: Map<number, DescriptionResult>,
) {
  const byJk = new Map<string, DescriptionTarget>();
  for (const t of batch) {
    const jk = indeedJk(t.url);
    if (jk) byJk.set(jk, t);
    else results.set(t.id, { status: "missing" });
  }
  if (byJk.size === 0) return;

  let pages = new Map<string, string>();
  try {
    // One attempt: postings that fail are retried on a later batch, and
    // Tavily's internal retries would triple how long a batch takes.
    pages = await extractPages(
      [...byJk.keys()].map((jk) => `https://au.indeed.com/rc/clk?jk=${jk}`),
      1,
    );
  } catch (err) {
    console.error("Indeed description extract failed", err);
  }

  const contentByJk = new Map<string, string>();
  for (const [url, content] of pages) {
    const jk = indeedJk(url);
    if (jk) contentByJk.set(jk, content);
  }
  for (const [jk, t] of byJk) {
    const content = contentByJk.get(jk);
    if (content === undefined) {
      results.set(t.id, { status: "failed" });
      continue;
    }
    const text =
      parseIndeedDescription(content) ??
      parseExternalDescription(content, t.title);
    results.set(
      t.id,
      text ? { status: "found", description: text } : { status: "missing" },
    );
  }
}

/**
 * Indeed job page (markdown):
 *   #### Full job description
 *   **Senior Civil Infrastructure Engineer**
 *   …
 *   *   Lead and deliver …
 *   ### Company and salary information     ← or "Report job"
 */
export function parseIndeedDescription(markdown: string): string | null {
  const start = /^#{2,5}\s*Full job description\s*$/im.exec(markdown);
  if (!start) return null;
  const rest = markdown.slice(start.index + start[0].length);
  const end = /^(#{1,3}\s|Report job\s*$)/m.exec(rest);
  const body = end ? rest.slice(0, end.index) : rest;

  return markdownToText(body) || null;
}

/**
 * An employer careers page (SmartRecruiters, LiveHire, …) that an Indeed
 * link redirected to. Best effort: take everything from the heading with the
 * job title down to the first "share / similar jobs" style heading.
 */
export function parseExternalDescription(
  markdown: string,
  title: string,
): string | null {
  const headings = [...markdown.matchAll(/^#{1,4}\s+(.+)$/gm)];
  const start = headings.find((h) => titleMatchesKeyword(h[1]!, title));
  if (!start) return null;

  const rest = markdown.slice(start.index + start[0].length);
  const end =
    /^(#{1,4}\s+.*\b(share|similar|other jobs|related jobs|more jobs|you may also)|\s*(Back to top|Powered by)\b)/im.exec(
      rest,
    );
  const text = markdownToText(end ? rest.slice(0, end.index) : rest);
  // Too short to be a real description (e.g. a "job closed" page).
  return text.length >= 200 ? text : null;
}

function markdownToText(markdown: string): string {
  return tidy(
    markdown
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\*\*|__/g, "")
      .replace(/^\s*[*-]\s+/gm, "• ")
      .replace(/^#{1,6}\s*/gm, ""),
  );
}

// ---------------------------------------------------------------------------

async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
}
