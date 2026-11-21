import { env } from "~/env";

/** Location appended to every search. Change this to target another market. */
export const JOB_SEARCH_LOCATION = "Australia";

/**
 * Job boards we search. Each one is queried separately so a single board
 * doesn't crowd the others out of the results.
 *
 * - `domains` can include a path: "seek.com.au/job" restricts results to
 *   individual postings instead of search-result pages.
 * - `timeRange` limits results to pages Tavily indexed recently, which is
 *   what filters out old / expired postings. ("week" returns almost nothing
 *   for these boards; "month" is the sweet spot.)
 * - Indeed blocks crawlers from individual postings, so for Indeed we get
 *   live search-result pages (e.g. "Front End Developer jobs in Sydney"),
 *   which are always current — no time filter needed.
 *
 * Note: Tavily does not return a posted date for any of these boards, and
 * both Seek and LinkedIn block Tavily's extract endpoint, so we can't read
 * "Posted 3d ago" from the page. Recency is approximated by the posting id
 * (see `postingId`).
 */
export const JOB_SOURCES = {
  seek: {
    label: "Seek",
    domains: ["seek.com.au/job"],
    query: (kw: string) => `"${kw}" ${JOB_SEARCH_LOCATION}`,
    timeRange: "month",
  },
  linkedin: {
    label: "LinkedIn",
    domains: ["linkedin.com/jobs/view"],
    query: (kw: string) => `"${kw}" ${JOB_SEARCH_LOCATION}`,
    timeRange: "month",
  },
  indeed: {
    label: "Indeed",
    domains: ["au.indeed.com"],
    query: (kw: string) => `${kw} jobs ${JOB_SEARCH_LOCATION}`,
    timeRange: null,
  },
} as const satisfies Record<
  string,
  {
    label: string;
    domains: readonly string[];
    query: (kw: string) => string;
    timeRange: "day" | "week" | "month" | "year" | null;
  }
>;

export type JobSource = keyof typeof JOB_SOURCES;

/** Order sources appear in when the feed interleaves them. */
export const SOURCE_ORDER: JobSource[] = ["seek", "linkedin", "indeed"];

export interface JobSearchResult {
  source: JobSource;
  title: string;
  url: string;
  /**
   * Numeric posting id from the URL (Seek / LinkedIn). Both boards assign ids
   * sequentially, so a higher id means a more recently posted job — this is
   * what the feed sorts on. Null for Indeed search pages.
   */
  postingId: number | null;
  snippet: string | null;
  score: number | null;
  publishedAt: Date | null;
}

interface TavilyResponse {
  results?: {
    title?: string;
    url?: string;
    content?: string;
    score?: number;
    published_date?: string;
  }[];
}

/** Bot-protection pages Tavily sometimes indexes instead of the real page. */
const BLOCKED_TITLE = /just a moment|attention required|access denied|security check/i;

/** Board-name suffixes on page titles, e.g. "Frontend Developer Job in Sydney NSW - SEEK". */
const TITLE_SUFFIX = /\s*[-|–]\s*(seek|indeed|linkedin)\b[^|–-]*$/i;

/** Lowercase and strip everything but letters/digits ("Front-End Dev" → "frontenddev"). */
const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * True if every word of the keyword appears in the title, ignoring spacing
 * and punctuation — so "Front End Developer" matches "Frontend Developer".
 * The time filter makes Tavily return recent-but-unrelated postings, so this
 * keeps the feed on-topic.
 */
export function titleMatchesKeyword(title: string, keyword: string): boolean {
  const haystack = squash(title);
  const words = keyword.split(/\s+/).map(squash).filter(Boolean);
  return words.length > 0 && words.every((w) => haystack.includes(w));
}

/**
 * Normalise a posting URL so the same job found via different links is
 * stored once (Seek adds ?type=…&ref=…, /apply, etc.) and pull out its
 * numeric id. Returns null for pages that aren't postings / job searches.
 */
function parseJobUrl(
  source: JobSource,
  raw: string,
): { url: string; postingId: number | null } | null {
  let url: URL;
  try {
    url = new URL(raw.replaceAll("&amp;", "&"));
  } catch {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, "");

  switch (source) {
    case "seek": {
      const id = /^\/job\/(\d+)/.exec(path)?.[1];
      return id
        ? { url: `https://www.seek.com.au/job/${id}`, postingId: Number(id) }
        : null;
    }
    case "linkedin": {
      if (!path.startsWith("/jobs/view/")) return null;
      // Every LinkedIn posting URL ends in its numeric id; normalise on that.
      const id = /(\d{6,})$/.exec(path)?.[1];
      return id
        ? { url: `https://www.linkedin.com/jobs/view/${id}`, postingId: Number(id) }
        : { url: `https://www.linkedin.com${path}`, postingId: null };
    }
    case "indeed": {
      if (path.startsWith("/viewjob")) {
        const jk = url.searchParams.get("jk");
        return jk
          ? { url: `https://au.indeed.com/viewjob?jk=${jk}`, postingId: null }
          : null;
      }
      if (path.startsWith("/q-") || path.startsWith("/jobs")) {
        const search = path.startsWith("/jobs") ? url.search : "";
        return { url: `https://au.indeed.com${path}${search}`, postingId: null };
      }
      return null;
    }
  }
}

async function searchSource(
  keyword: string,
  source: JobSource,
  maxResults: number,
): Promise<JobSearchResult[]> {
  const { query, domains, timeRange } = JOB_SOURCES[source];

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TAVILY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: query(keyword),
      include_domains: domains,
      max_results: maxResults,
      search_depth: "basic",
      ...(timeRange && { time_range: timeRange }),
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `Tavily search failed for ${source} (${res.status}): ${await res.text()}`,
    );
  }

  const data = (await res.json()) as TavilyResponse;

  return (data.results ?? []).flatMap((r) => {
    if (!r.url || !r.title || BLOCKED_TITLE.test(r.title)) return [];
    if (!titleMatchesKeyword(r.title, keyword)) return [];
    const parsed = parseJobUrl(source, r.url);
    if (!parsed) return [];

    const published = r.published_date ? new Date(r.published_date) : null;
    return [
      {
        source,
        title: r.title.replace(TITLE_SUFFIX, "").trim(),
        url: parsed.url,
        postingId: parsed.postingId,
        snippet: r.content?.trim() ?? null,
        score: typeof r.score === "number" ? r.score : null,
        publishedAt:
          published && !Number.isNaN(published.getTime()) ? published : null,
      },
    ];
  });
}

/**
 * Search every job board for one keyword. A board that errors is skipped
 * (and reported in `errors`) rather than failing the whole search;
 * `succeeded` lists the boards whose search completed.
 */
export async function searchJobs(
  keyword: string,
  { maxResultsPerSource = 10 }: { maxResultsPerSource?: number } = {},
): Promise<{
  results: JobSearchResult[];
  succeeded: JobSource[];
  errors: string[];
}> {
  const settled = await Promise.allSettled(
    SOURCE_ORDER.map((s) => searchSource(keyword, s, maxResultsPerSource)),
  );

  const results: JobSearchResult[] = [];
  const succeeded: JobSource[] = [];
  const errors: string[] = [];
  settled.forEach((r, i) => {
    const source = SOURCE_ORDER[i]!;
    if (r.status === "fulfilled") {
      results.push(...r.value);
      succeeded.push(source);
    } else {
      console.error(r.reason);
      errors.push(`${JOB_SOURCES[source].label}: search failed`);
    }
  });
  return { results, succeeded, errors };
}
