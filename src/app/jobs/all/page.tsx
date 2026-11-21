import type { Metadata } from "next";

import { postedLabel } from "~/components/jobs/job-card";
import { JobsTable, type JobRow } from "~/components/jobs/jobs-table";
import { requireUser } from "~/server/auth";
import { JOB_SOURCES, type JobSource } from "~/server/job-boards";
import { getAllJobs, getKeywords } from "~/server/jobs";

export const metadata: Metadata = {
  title: "All Jobs",
  description: "Every role we've found for you, in one table.",
};

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

export default async function AllJobsPage() {
  const user = await requireUser();
  const [jobs, keywords] = await Promise.all([
    getAllJobs(user.id),
    getKeywords(user.id),
  ]);
  const tracked = new Set(keywords.map((k) => k.keyword));

  // Labels are computed here so server and client render identical text
  // (no timezone / clock drift hydration mismatches).
  const rows: JobRow[] = jobs.map((job) => ({
    id: job.id,
    title: job.title,
    url: job.url,
    source: job.source,
    sourceLabel: JOB_SOURCES[job.source as JobSource]?.label ?? job.source,
    keyword: job.keyword,
    keywordTracked: tracked.has(job.keyword),
    company: job.company,
    location: job.location,
    snippet: job.snippet,
    postedAt: job.publishedAt?.getTime() ?? null,
    postedLabel: postedLabel(job).replace(/^Posted /, ""),
    foundAt: job.fetchedAt.getTime(),
    foundLabel: foundLabel(job.fetchedAt),
    foundTitle: dateFormat.format(job.fetchedAt),
  }));

  return (
    <>
      <section className="space-y-2">
        <h1 className="font-heading text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
          All <span className="text-aura-gradient">jobs</span>
        </h1>
        <p className="text-muted-foreground text-sm sm:text-base">
          Every role we&apos;ve found for you across Seek, LinkedIn and Indeed —
          including past searches. Search, filter and sort to dig in.
        </p>
      </section>

      <JobsTable rows={rows} />
    </>
  );
}
