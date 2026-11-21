import type { Metadata } from "next";

import { formatJobRows } from "~/components/jobs/format-job-rows";
import { JobsTable } from "~/components/jobs/jobs-table";
import { requireUser } from "~/server/auth";
import { getAllJobs, getKeywords, getTrackedJobIds } from "~/server/jobs";

export const metadata: Metadata = {
  title: "All Jobs",
  description: "Every role we've found for you, in one table.",
};

export default async function AllJobsPage() {
  const user = await requireUser();
  const [jobs, keywords, trackedJobIds] = await Promise.all([
    getAllJobs(user.id),
    getKeywords(user.id),
    getTrackedJobIds(user.id),
  ]);
  const trackedKeywords = new Set(keywords.map((k) => k.keyword));
  const rows = formatJobRows(jobs, trackedKeywords, trackedJobIds);

  return (
    <>
      <section className="space-y-2">
        <h1 className="font-heading text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
          All <span className="text-aura-gradient">jobs</span>
        </h1>
        <p className="text-muted-foreground text-sm sm:text-base">
          Every role we&apos;ve found for you across Seek, LinkedIn and Indeed —
          including past searches. Use the checkboxes to curate roles into your{" "}
          <span className="text-foreground font-medium">Tracking</span>{" "}
          shortlist for CV and resume tailoring.
        </p>
      </section>

      <JobsTable rows={rows} mode="all" />
    </>
  );
}
