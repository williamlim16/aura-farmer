/**
 * Job boards we pull listings from, and parsers for their search-result pages.
 *
 * Instead of searching the web for individual posting pages (which surfaces
 * months-old postings), we fetch each board's own search-results page —
 * filtered to recent listings — through Tavily Extract, and parse the job
 * cards out of the returned markdown. That gives real, current listings with
 * a "posted N days ago" age.
 *
 * Pure functions only (no network, no env), so this is safe to import from
 * UI code and easy to test against saved pages.
 */

/** Location searched on every board. Change this to target another market. */
export const JOB_SEARCH_LOCATION = "Australia";

/** Only listings posted within this many days are requested from the boards. */
export const RECENT_DAYS = 7;

export const JOB_SOURCES = {
  seek: {
    label: "Seek",
    // e.g. https://au.seek.com/data-analyst-jobs?daterange=7 (all of Australia).
    // Adding a sort parameter makes Tavily fail to fetch the page.
    searchUrl: (kw: string) =>
      `https://au.seek.com/${slugify(kw)}-jobs?daterange=${RECENT_DAYS}`,
  },
  linkedin: {
    label: "LinkedIn",
    searchUrl: (kw: string) =>
      `https://www.linkedin.com/jobs/search?${new URLSearchParams({
        keywords: kw,
        location: JOB_SEARCH_LOCATION,
        f_TPR: `r${RECENT_DAYS * 24 * 60 * 60}`,
        sortBy: "DD",
      })}`,
  },
  indeed: {
    label: "Indeed",
    // Relevance order: sorting Indeed by date surfaces loosely related roles.
    searchUrl: (kw: string) =>
      `https://au.indeed.com/jobs?${new URLSearchParams({
        q: kw,
        l: JOB_SEARCH_LOCATION,
        fromage: String(RECENT_DAYS),
      })}`,
  },
} as const satisfies Record<
  string,
  { label: string; searchUrl: (kw: string) => string }
>;

export type JobSource = keyof typeof JOB_SOURCES;

/** Display label for a stored `jobs.source` (boards, plus "company" research). */
export function sourceLabel(source: string): string {
  if (source === "company") return "Company research";
  return JOB_SOURCES[source as JobSource]?.label ?? source;
}

/** Order sources appear in when the feed interleaves them. */
export const SOURCE_ORDER: JobSource[] = ["seek", "linkedin", "indeed"];

export interface JobSearchResult {
  source: JobSource;
  title: string;
  /** Canonical posting URL — the dedupe key, so tracking params are stripped. */
  url: string;
  /** Numeric posting id (Seek / LinkedIn); higher = posted more recently. */
  postingId: number | null;
  company: string | null;
  location: string | null;
  snippet: string | null;
  score: number | null;
  /**
   * When the job was posted, from the card's "2d ago". Approximate (to the
   * unit shown). Null for Indeed, whose cards show no date — Indeed results
   * are still limited to the last RECENT_DAYS days by the search filter.
   */
  publishedAt: Date | null;
}

/** "Front-End Developer (React)" → "front-end-developer-react" */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Lowercase and strip everything but letters/digits ("Front-End Dev" → "frontenddev"). */
const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * True if every word of the keyword appears in the title, ignoring spacing
 * and punctuation — so "Front End Developer" matches "Frontend Developer".
 * Boards pad their results with loosely related roles; this keeps the feed
 * on-topic.
 */
export function titleMatchesKeyword(title: string, keyword: string): boolean {
  const haystack = squash(title);
  const words = keyword.split(/\s+/).map(squash).filter(Boolean);
  return words.length > 0 && words.every((w) => haystack.includes(w));
}

/** Strip markdown emphasis and collapse whitespace. */
const clean = (text: string) =>
  text
    .replace(/\*\*|__/g, "")
    .replace(/\s+/g, " ")
    .trim();

const UNIT_MS: Record<string, number> = {
  m: 60_000,
  minute: 60_000,
  h: 3_600_000,
  hour: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  w: 7 * 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
};

/** "19h ago" / "3 days ago" → a Date relative to `now`. */
function agoToDate(amount: string, unit: string, now: Date): Date | null {
  const ms = UNIT_MS[unit.toLowerCase().replace(/s$/, "")];
  return ms ? new Date(now.getTime() - Number(amount) * ms) : null;
}

/** Split `content` into chunks, each starting at a match of `start`. */
function chunksAt(content: string, start: RegExp): string[] {
  const indexes = [...content.matchAll(start)].map((m) => m.index);
  return indexes.map((from, i) => content.slice(from, indexes[i + 1]));
}

/**
 * Seek card (markdown):
 *   ### [Data Analyst](https://au.seek.com/job/95984255?type=standard&…)
 *   at[Chandler Macleod](…)
 *   This is a Contract/Temp job
 *   [Brisbane QLD](… "Limit results to Brisbane QLD")(Hybrid)   ← or plain "Perth WA"
 *   Competitive
 *   *   bullet …
 *   Join a major data transformation project …
 *   subClassification: …
 *   1d ago
 */
function parseSeek(content: string, now: Date): JobSearchResult[] {
  return chunksAt(
    content,
    /^### \[[^\]]+\]\(https:\/\/[^)]*\/job\/\d+/gm,
  ).flatMap((card) => {
    const head = /^### \[([^\]]+)\]\(https:\/\/[^)]*\/job\/(\d+)/.exec(card);
    if (!head) return [];
    const [, title, id] = head;

    // Location is the first line after "This is a Full time job", either
    // plain text or a "Limit results to …" link, plus "(Hybrid)" etc.
    const locationLine = /^This is an? [^\n]* job\s*\n\s*([^\n]+)/m.exec(
      card,
    )?.[1];
    const location = locationLine
      ?.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\(([^)]+)\)/g, " ($1)");
    const age = /^(\d+)([mhd])\+? ago/m.exec(card);

    // The summary is the last plain-text line before "subClassification".
    const body = card.split(/^subClassification:/m)[0]!;
    const summary = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^[*![#]|^at\[|^This is a |^Recruited by /.test(l))
      .at(-1);

    return [
      {
        source: "seek" as const,
        title: clean(title!),
        url: `https://au.seek.com/job/${id}`,
        postingId: Number(id),
        company: clean(/^at\s*\[([^\]]+)\]/m.exec(card)?.[1] ?? "") || null,
        location: location ? clean(location) || null : null,
        snippet: summary ? clean(summary) : null,
        score: null,
        publishedAt: age ? agoToDate(age[1]!, age[2]!, now) : null,
      },
    ];
  });
}

/**
 * LinkedIn card (markdown, advanced extract):
 *   *   [Senior Data Analyst](https://au.linkedin.com/jobs/view/senior-data-analyst-at-x-4490871738?position=3&…)![…](…) ### Senior Data Analyst
 *   #### [Great Southern Bank](https://au.linkedin.com/company/…)
 *    Brisbane, Queensland, Australia  Be an early applicant   2 days ago
 */
function parseLinkedIn(content: string, now: Date): JobSearchResult[] {
  return chunksAt(
    content,
    /^\*\s+\[[^\]]+\]\(https:\/\/[^)]*linkedin\.com\/jobs\/view\//gm,
  ).flatMap((card) => {
    const head =
      /^\*\s+\[([^\]]+)\]\(https:\/\/[^)]*linkedin\.com\/jobs\/view\/[^)?]*?(\d{6,})[)?]/.exec(
        card,
      );
    if (!head) return [];
    const [, title, id] = head;

    const company = /^#### (?:\[([^\]]+)\]\([^)]*\)|(.+))/m.exec(card);
    const companyEnd = company ? company.index + company[0].length : 0;
    const meta = card
      .slice(companyEnd)
      .split("\n")
      .find((l) => l.trim());
    const age = /(\d+)\s+(minute|hour|day|week|month)s?\s+ago/i.exec(card);

    return [
      {
        source: "linkedin" as const,
        title: clean(title!),
        url: `https://www.linkedin.com/jobs/view/${id}`,
        postingId: Number(id),
        company: company ? clean(company[1] ?? company[2] ?? "") || null : null,
        // " Brisbane, Queensland, Australia  Be an early applicant   2 days ago"
        location: meta ? clean(meta.trim().split(/\s{2,}/)[0]!) || null : null,
        snippet: null,
        score: null,
        publishedAt: age ? agoToDate(age[1]!, age[2]!, now) : null,
      },
    ];
  });
}

/**
 * Indeed card (markdown, advanced extract):
 *   ### [Enablon Business Senior Analyst](https://au.indeed.com/rc/clk?jk=39db9ddeeb0565e4&…) Fortescue Perth WA
 *       *   Facilitate user feedback and use service **data** to identify …
 *       *   View all [Fortescue jobs](…) - …
 * Company and location run together after the link, so they're kept as one
 * string in `company`.
 */
function parseIndeed(content: string): JobSearchResult[] {
  return chunksAt(
    content,
    /^### \[[^\]]+\]\(https:\/\/au\.indeed\.com\/[^)]*jk=/gm,
  ).flatMap((card) => {
    const head =
      /^### \[([^\]]+)\]\(https:\/\/au\.indeed\.com\/[^)]*[?&]jk=([0-9a-f]+)[^)]*\)([^\n]*)/.exec(
        card,
      );
    if (!head) return [];
    const [, title, jk, companyAndLocation] = head;

    const snippet = card
      .split("\n")
      .map((l) => l.trim().replace(/^\*\s+/, ""))
      .find(
        (l) =>
          l &&
          !l.startsWith("###") &&
          !/^(View all|Salary Search|See popular)/.test(l),
      );

    return [
      {
        source: "indeed" as const,
        title: clean(title!),
        url: `https://au.indeed.com/viewjob?jk=${jk}`,
        postingId: null,
        company: clean(companyAndLocation ?? "") || null,
        location: null,
        snippet: snippet ? clean(snippet) : null,
        score: null,
        publishedAt: null,
      },
    ];
  });
}

/**
 * Parse a board's search-results page into job listings, keeping only titles
 * that match the keyword. `now` is when the page was fetched (for "2d ago").
 */
export function parseSearchPage(
  source: JobSource,
  content: string,
  keyword: string,
  now: Date,
): JobSearchResult[] {
  const parsed =
    source === "seek"
      ? parseSeek(content, now)
      : source === "linkedin"
        ? parseLinkedIn(content, now)
        : parseIndeed(content);

  // Cards can repeat (Seek renders some twice); keep the first of each url.
  const unique = [
    ...new Map(parsed.reverse().map((j) => [j.url, j])).values(),
  ].reverse();
  return unique.filter((j) => titleMatchesKeyword(j.title, keyword));
}
