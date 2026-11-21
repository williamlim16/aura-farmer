import { env } from "~/env";

export interface RecommendationTarget {
  id: number;
  title: string;
  company: string | null;
  location: string | null;
  snippet: string | null;
  description: string | null;
  url: string;
}

export type RecommendationResult =
  | { status: "found"; recommendation: string }
  | { status: "missing" }
  | { status: "failed" };

interface TavilyResearchResponse {
  request_id?: string;
  status?: string;
  content?: unknown;
}

interface TavilySearchResponse {
  answer?: string;
  results?: { title?: string; url?: string; content?: string }[];
}

const RESEARCH_CONCURRENCY = 3;
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 15;
const MAX_LENGTH = 10_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function buildResearchInput(target: RecommendationTarget): string {
  const company = target.company?.trim();
  const location = target.location?.trim();
  const rawContext = (target.description ?? target.snippet ?? "").trim();
  const excerpt = rawContext ? rawContext.slice(0, 500).trimEnd() : null;

  const intro = company
    ? `Research the company "${company}"${location ? ` (location: ${location})` : ""} for a candidate applying to the role "${target.title}".`
    : `Identify the employer for the job posting "${target.title}"${location ? ` (${location})` : ""} (posting URL: ${target.url}) and research that company for a job applicant.`;

  const sections = [
    intro,
    excerpt ? `Job context excerpt:\n${excerpt}` : null,
    [
      "Provide a concise, practical brief using clear section headings and bullet points covering:",
      "1. Company Overview & Culture: Who the company is, what they do, core products or services, industry standing, and workplace culture or values so the applicant knows who they are applying to.",
      `2. Application & Interview Recommendations: Tailored advice on skills, achievements, and themes to emphasize on a CV/application, plus interview preparation tips for the "${target.title}" role at this company.`,
    ].join("\n"),
  ];

  return sections.filter(Boolean).join("\n\n");
}

function buildSearchQuery(target: RecommendationTarget): string {
  const company = target.company?.trim();
  const location = target.location?.trim();
  const subject = company
    ? `${company} ${target.title}`
    : `${target.title} company`;
  const loc = location ? ` ${location}` : "";
  return `Company overview, culture, values, and job application tips for ${subject}${loc}`.slice(
    0,
    380,
  );
}

export function formatResearchText(markdown: string): string {
  const cleaned = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__/g, "")
    .replace(/^\s*[*-]\s+/gm, "• ")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/^• *$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    // Keep consecutive bullet items tight without blank lines between them.
    .replace(/^(• [^\n]*)\n\n(?=• )/gm, "$1\n")
    .trim();

  if (!cleaned) return "";
  return cleaned.length > MAX_LENGTH
    ? `${cleaned.slice(0, MAX_LENGTH).trimEnd()}…`
    : cleaned;
}

async function tryTavilyResearch(
  target: RecommendationTarget,
): Promise<string | null> {
  const res = await fetch("https://api.tavily.com/research", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TAVILY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: buildResearchInput(target),
      model: "mini",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) return null;

  const data = (await res.json()) as TavilyResearchResponse;
  if (
    data.status === "completed" &&
    typeof data.content === "string" &&
    data.content.trim()
  ) {
    return formatResearchText(data.content) || null;
  }

  if (!data.request_id || data.status === "failed") return null;

  const pollUrl = `https://api.tavily.com/research/${encodeURIComponent(data.request_id)}`;
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    const pollRes = await fetch(pollUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.TAVILY_API_KEY}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    if (!pollRes.ok) return null;

    const pollData = (await pollRes.json()) as TavilyResearchResponse;
    if (
      pollData.status === "completed" &&
      typeof pollData.content === "string" &&
      pollData.content.trim()
    ) {
      return formatResearchText(pollData.content) || null;
    }

    if (pollData.status === "failed" || pollData.status === "error") {
      return null;
    }
  }

  return null;
}

async function tryTavilySearchFallback(
  target: RecommendationTarget,
): Promise<string | null> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TAVILY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: buildSearchQuery(target),
      search_depth: "advanced",
      include_answer: "advanced",
      max_results: 5,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) return null;

  const data = (await res.json()) as TavilySearchResponse;
  const answer = data.answer?.trim() ?? "";
  const highlights = (data.results ?? [])
    .filter((r) => r.content?.trim())
    .slice(0, 3)
    .map((r) => `• ${r.title ? `${r.title}: ` : ""}${r.content!.trim()}`)
    .join("\n");

  const combined = [
    answer || null,
    !answer && highlights
      ? `Company & Role Insights:\n${highlights}`
      : answer && answer.length < 250 && highlights
        ? `Additional Context:\n${highlights}`
        : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!combined) return null;
  return formatResearchText(combined) || null;
}

export async function researchSingleTarget(
  target: RecommendationTarget,
): Promise<RecommendationResult> {
  try {
    const researched = await tryTavilyResearch(target);
    if (researched) {
      return { status: "found", recommendation: researched };
    }
  } catch (err) {
    console.error(
      "Tavily research request failed, falling back to search",
      err,
    );
  }

  try {
    const searched = await tryTavilySearchFallback(target);
    if (searched) {
      return { status: "found", recommendation: searched };
    }
  } catch (err) {
    console.error("Tavily search fallback failed", err);
  }

  return { status: "failed" };
}

function dedupeKey(target: RecommendationTarget): string {
  const company = target.company?.trim().toLowerCase() ?? "";
  const title = target.title.trim().toLowerCase();
  if (company) return `${company}::${title}`;
  return `${target.url}::${title}`;
}

export async function fetchRecommendations(
  targets: RecommendationTarget[],
): Promise<Map<number, RecommendationResult>> {
  const results = new Map<number, RecommendationResult>();
  if (targets.length === 0) return results;

  const uniqueTasks = new Map<string, RecommendationTarget>();
  for (const target of targets) {
    const key = dedupeKey(target);
    if (!uniqueTasks.has(key)) {
      uniqueTasks.set(key, target);
    }
  }

  const byKey = new Map<string, RecommendationResult>();
  await mapLimit(
    [...uniqueTasks.entries()],
    RESEARCH_CONCURRENCY,
    async ([key, target]) => {
      byKey.set(key, await researchSingleTarget(target));
    },
  );

  for (const target of targets) {
    const result = byKey.get(dedupeKey(target)) ?? {
      status: "failed" as const,
    };
    results.set(target.id, result);
  }

  return results;
}

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
