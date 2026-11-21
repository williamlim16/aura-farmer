import type { Metadata } from "next";
import { Briefcase, Target, X } from "lucide-react";

import { removeKeywordAction } from "~/app/jobs/actions";
import { JobCard } from "~/components/jobs/job-card";
import { KeywordForm } from "~/components/jobs/keyword-form";
import { RefreshJobsButton } from "~/components/jobs/refresh-jobs-button";
import { Badge } from "~/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { requireUser } from "~/server/auth";
import { getJobFeed, getKeywords, MAX_KEYWORDS } from "~/server/jobs";

export const metadata: Metadata = {
  title: "Curated Jobs",
  description: "Roles matched to your target job titles.",
};

export default async function JobsPage() {
  const user = await requireUser();
  const [keywords, feed] = await Promise.all([
    getKeywords(user.id),
    getJobFeed(user.id),
  ]);

  return (
    <>
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="space-y-2">
          <h1 className="font-heading text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
            Tailored <span className="text-aura-gradient">feed</span>
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Recent roles from Seek, LinkedIn and Indeed matched to your target
            job titles, newest first.
          </p>
        </div>
        <RefreshJobsButton disabled={keywords.length === 0} />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_2.2fr]">
        {/* Keywords */}
        <Card className="h-fit">
          <CardHeader>
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="font-mono uppercase">
                Job titles
              </Badge>
              <Target
                aria-hidden="true"
                className="text-aura-secondary size-4"
              />
            </div>
            <CardTitle className="text-lg">What are you looking for?</CardTitle>
            <CardDescription>
              Add up to {MAX_KEYWORDS} job titles, then hit{" "}
              <span className="text-foreground font-medium">Find jobs</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <KeywordForm disabled={keywords.length >= MAX_KEYWORDS} />
            {keywords.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {keywords.map((k) => (
                  <li key={k.id}>
                    <form action={removeKeywordAction}>
                      <input type="hidden" name="id" value={k.id} />
                      <Badge
                        variant="default"
                        className="gap-1 py-1 pr-1 text-xs"
                      >
                        {k.keyword}
                        <button
                          type="submit"
                          aria-label={`Remove ${k.keyword}`}
                          className="hover:bg-primary/20 inline-flex size-4 cursor-pointer items-center justify-center rounded-full"
                        >
                          <X aria-hidden="true" className="size-3" />
                        </button>
                      </Badge>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Feed */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-foreground text-lg font-medium">
              Matches
            </h2>
            <span className="text-muted-foreground font-mono text-xs">
              {feed.length} result{feed.length === 1 ? "" : "s"}
            </span>
          </div>

          {feed.length === 0 ? (
            <div className="border-border bg-background/45 flex flex-col items-start gap-3 rounded-xl border border-dashed p-6">
              <span className="border-aura-primary/25 bg-primary/10 text-aura-primary inline-flex size-10 items-center justify-center rounded-xl border">
                <Briefcase aria-hidden="true" className="size-5" />
              </span>
              <p className="font-heading text-foreground text-base font-medium">
                No jobs yet
              </p>
              <p className="text-muted-foreground max-w-md text-sm">
                {keywords.length === 0
                  ? "Add a job title on the left to get started."
                  : "Click “Find jobs” to search Seek, Indeed and LinkedIn."}
              </p>
            </div>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {feed.map((job) => (
                <li key={job.id}>
                  <JobCard job={job} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
