import { env } from "~/env";
import {
  JOB_SOURCES,
  parseSearchPage,
  SOURCE_ORDER,
  type JobSearchResult,
  type JobSource,
} from "~/server/job-boards";

interface TavilyExtractResponse {
  results?: { url: string; raw_content?: string }[];
  failed_results?: { url: string; error?: string }[];
}

/**
 * Tavily Extract fails intermittently on these boards ("Failed to fetch url"
 * for a page that works on the next try), so failed pages are retried.
 */
const EXTRACT_ATTEMPTS = 3;

/** Compare URLs regardless of encoding ("data+analyst" vs "data%20analyst"). */
function urlKey(url: string): string {
  try {
    return decodeURIComponent(url.replace(/\+/g, " "));
  } catch {
    return url;
  }
}

/**
 * Fetch pages through Tavily Extract. Returns url → markdown for the pages
 * that succeeded; pages still failing after every attempt are left out.
 * "advanced" depth is required — "basic" can't fetch Seek / Indeed search
 * pages and returns LinkedIn's without job links.
 */
async function extractPages(urls: string[]): Promise<Map<string, string>> {
  const pages = new Map<string, string>();
  let pending = urls;

  for (let attempt = 1; attempt <= EXTRACT_ATTEMPTS && pending.length > 0; attempt++) {
    const res = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.TAVILY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ urls: pending, extract_depth: "advanced" }),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Tavily extract failed (${res.status}): ${await res.text()}`);
    }

    const data = (await res.json()) as TavilyExtractResponse;
    for (const r of data.results ?? []) {
      if (r.raw_content) pages.set(urlKey(r.url), r.raw_content);
    }
    pending = pending.filter((url) => !pages.has(urlKey(url)));
  }
  return pages;
}

/**
 * Fetch every board's recent-listings search page for one keyword and parse
 * the job cards out of it. A board whose page can't be fetched is skipped
 * and reported in `errors` rather than failing the whole search.
 */
export async function searchJobs(keyword: string): Promise<{
  results: JobSearchResult[];
  errors: string[];
}> {
  const urls = new Map<JobSource, string>(
    SOURCE_ORDER.map((s) => [s, JOB_SOURCES[s].searchUrl(keyword)]),
  );
  const fetchedAt = new Date();

  let pages: Map<string, string>;
  try {
    pages = await extractPages([...urls.values()]);
  } catch (err) {
    console.error(err);
    return { results: [], errors: ["job search failed"] };
  }

  const results: JobSearchResult[] = [];
  const errors: string[] = [];
  for (const [source, url] of urls) {
    const page = pages.get(urlKey(url));
    if (page === undefined) {
      errors.push(`${JOB_SOURCES[source].label}: couldn't load results`);
      continue;
    }
    results.push(...parseSearchPage(source, page, keyword, fetchedAt));
  }
  return { results, errors };
}
