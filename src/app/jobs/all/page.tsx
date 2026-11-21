import type { Metadata } from "next";

import { FetchDescriptionsButton } from "~/components/jobs/fetch-descriptions-button";
import { formatJobRows } from "~/components/jobs/format-job-rows";
import { JobsTable } from "~/components/jobs/jobs-table";
import { requireUser } from "~/server/auth";
import {
  getAllJobs,
  getKeywords,
  getTrackedJobStatuses,
  MAX_DESCRIPTION_ATTEMPTS,
} from "~/server/jobs";

export const metadata: Metadata = {
  title: "All Jobs",
  description: "Every role we've found for you, in one table.",
};

export default async function AllJobsPage() {
  const user = await requireUser();
  const [jobs, keywords, trackedStatuses] = await Promise.all([
    getAllJobs(user.id),
    getKeywords(user.id),
    getTrackedJobStatuses(user.id),
  ]);
  const trackedKeywords = new Set(keywords.map((k) => k.keyword));
  const rows = formatJobRows(jobs, trackedKeywords, trackedStatuses);
  const missingDescriptions = jobs.filter(
    (job) =>
      job.description === null &&
      job.descriptionAttempts < MAX_DESCRIPTION_ATTEMPTS,
  ).length;

  return (
    <>
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <h1 className="font-heading text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
            All <span className="text-aura-gradient">jobs</span>
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Every role we&apos;ve found for you across Seek, LinkedIn and Indeed
            — including past searches. Use the checkboxes to curate roles into
            your <span className="text-foreground font-medium">Tracking</span>{" "}
            shortlist for CV and resume tailoring.
          </p>
        </div>
        <FetchDescriptionsButton missing={missingDescriptions} />
      </section>

      <JobsTable rows={rows} mode="all" />
    </>
  );
}
