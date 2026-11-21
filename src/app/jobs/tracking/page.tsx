import type { Metadata } from "next";

import { formatJobRows } from "~/components/jobs/format-job-rows";
import { JobsTable } from "~/components/jobs/jobs-table";
import { normalizeTrackingStatus } from "~/lib/tracking-status";
import { requireUser } from "~/server/auth";
import { getKeywords, getTrackedJobs } from "~/server/jobs";
import { getTailoredResumeStatuses } from "~/server/tailored-resumes";

// Tailoring (server action on this page) calls an LLM and a LaTeX compiler.
export const maxDuration = 300;

export const metadata: Metadata = {
  title: "Job Tracking",
  description:
    "Your curated shortlist of roles selected for CV and resume tailoring.",
};

export default async function TrackingJobsPage() {
  const user = await requireUser();
  const [jobs, keywords, tailored] = await Promise.all([
    getTrackedJobs(user.id),
    getKeywords(user.id),
    getTailoredResumeStatuses(user.id),
  ]);
  const trackedKeywords = new Set(keywords.map((k) => k.keyword));
  const trackedStatuses = new Map(
    jobs.map((j) => [j.id, normalizeTrackingStatus(j.trackingStatus)]),
  );
  const rows = formatJobRows(jobs, trackedKeywords, trackedStatuses, tailored);

  return (
    <>
      <section className="space-y-2">
        <h1 className="font-heading text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
          Job <span className="text-aura-gradient">tracking</span>
        </h1>
        <p className="text-muted-foreground text-sm sm:text-base">
          Your deduplicated shortlist of roles selected from All jobs to curate
          tailored CVs and resumes.
        </p>
      </section>

      <JobsTable rows={rows} mode="tracking" />
    </>
  );
}
