import { postedLabel } from "~/components/jobs/job-card";
import type { JobRow } from "~/components/jobs/jobs-table";
import { JOB_SOURCES, type JobSource } from "~/server/job-boards";
import type { TailoredResumeStatus } from "~/server/tailored-resumes";

export interface FormattableJob {
  id: number;
  title: string;
  url: string;
  source: string;
  keyword: string;
  company: string | null;
  location: string | null;
  snippet: string | null;
  description: string | null;
  publishedAt: Date | null;
  fetchedAt: Date;
}

const dateFormat = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "Today" / "Yesterday" / "4d ago" / "12 Nov 2026". */
function foundLabel(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days < 1) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days}d ago`;
  return dateFormat.format(date);
}

/**
 * Formats server-fetched job rows with pre-computed date and source labels so
 * server and client render identical text without hydration mismatches.
 */
export function formatJobRows(
  jobs: FormattableJob[],
  trackedKeywords: Set<string>,
  trackedJobIds: Set<number>,
  tailored?: Map<number, TailoredResumeStatus>,
): JobRow[] {
  return jobs.map((job) => ({
    id: job.id,
    title: job.title,
    url: job.url,
    source: job.source,
    sourceLabel: JOB_SOURCES[job.source as JobSource]?.label ?? job.source,
    keyword: job.keyword,
    keywordTracked: trackedKeywords.has(job.keyword),
    tracked: trackedJobIds.has(job.id),
    company: job.company,
    location: job.location,
    snippet: job.snippet,
    description: job.description,
    postedAt: job.publishedAt?.getTime() ?? null,
    postedLabel: postedLabel(job).replace(/^Posted /, ""),
    foundAt: job.fetchedAt.getTime(),
    foundLabel: foundLabel(job.fetchedAt),
    foundTitle: dateFormat.format(job.fetchedAt),
    tailored: tailored?.get(job.id) ?? null,
  }));
}
