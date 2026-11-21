import { env } from "~/env";

/** Location appended to every search. Change this to target another market. */
export const JOB_SEARCH_LOCATION = "Australia";

/**
 * Job boards we search. Each one is queried separately so a single board
 * doesn't crowd the others out of the results.
 *
 * `domains` can include a path: "seek.com.au/job" restricts results to
 * individual postings instead of search-result pages.
 * Indeed blocks crawlers from individual postings, so for Indeed we get
 * search-result pages (e.g. "Front End Developer jobs in Sydney").
 */
export const JOB_SOURCES = {
  seek: {
    label: "Seek",
    domains: ["seek.com.au/job"],
    query: (kw: string) => `${kw} ${JOB_SEARCH_LOCATION}`,
  },
  linkedin: {
    label: "LinkedIn",
    domains: ["linkedin.com/jobs/view"],
    query: (kw: string) => `${kw} ${JOB_SEARCH_LOCATION}`,
  },
  indeed: {
    label: "Indeed",
    domains: ["au.indeed.com"],
    query: (kw: string) => `${kw} jobs ${JOB_SEARCH_LOCATION}`,
  },
} as const;

export type JobSource = keyof typeof JOB_SOURCES;

export interface JobSearchResult {
  source: JobSource;
  title: string;
  url: string;
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

/**
 * Normalise a posting URL so the same job found via different links is
 * stored once (Seek adds ?type=…&ref=…, /apply, etc.). Returns null for
 * pages that aren't postings / job searches.
 */
function canonicalJobUrl(source: JobSource, raw: string): string | null {
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
      return id ? `https://www.seek.com.au/job/${id}` : null;
    }
    case "linkedin": {
      if (!path.startsWith("/jobs/view/")) return null;
      // Every LinkedIn posting URL ends in its numeric id; normalise on that.
      const id = /(\d{6,})$/.exec(path)?.[1];
      return id
        ? `https://www.linkedin.com/jobs/view/${id}`
        : `https://www.linkedin.com${path}`;
    }
    case "indeed": {
      if (path.startsWith("/viewjob")) {
        const jk = url.searchParams.get("jk");
        return jk ? `https://au.indeed.com/viewjob?jk=${jk}` : null;
      }
      if (path.startsWith("/q-") || path.startsWith("/jobs")) {
        return `https://au.indeed.com${path}${path.startsWith("/jobs") ? url.search : ""}`;
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
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TAVILY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: JOB_SOURCES[source].query(keyword),
      include_domains: JOB_SOURCES[source].domains,
      max_results: maxResults,
      search_depth: "basic",
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
    const url = canonicalJobUrl(source, r.url);
    if (!url) return [];

    const published = r.published_date ? new Date(r.published_date) : null;
    return [
      {
        source,
        title: r.title.replace(TITLE_SUFFIX, "").trim(),
        url,
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
 * (and reported in `errors`) rather than failing the whole search.
 */
export async function searchJobs(
  keyword: string,
  { maxResultsPerSource = 8 }: { maxResultsPerSource?: number } = {},
): Promise<{ results: JobSearchResult[]; errors: string[] }> {
  const sources = Object.keys(JOB_SOURCES) as JobSource[];
  const settled = await Promise.allSettled(
    sources.map((s) => searchSource(keyword, s, maxResultsPerSource)),
  );

  const results: JobSearchResult[] = [];
  const errors: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") results.push(...r.value);
    else {
      console.error(r.reason);
      errors.push(`${JOB_SOURCES[sources[i]!].label}: search failed`);
    }
  });
  return { results, errors };
}
