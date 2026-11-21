import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Briefcase, Target, X } from "lucide-react";

import { removeKeywordAction } from "~/app/protected/jobs/actions";
import { AuraBackdrop } from "~/components/aura-backdrop";
import { BrandLogo } from "~/components/brand-logo";
import { JobCard } from "~/components/jobs/job-card";
import { KeywordForm } from "~/components/jobs/keyword-form";
import { RefreshJobsButton } from "~/components/jobs/refresh-jobs-button";
import { LogoutButton } from "~/components/logout-button";
import { ThemeToggle } from "~/components/theme-toggle";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
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
    <div className="relative flex min-h-svh flex-col overflow-x-clip">
      <AuraBackdrop variant="subtle" />

      <header className="glass-nav sticky top-0 z-40">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <BrandLogo href="/" showTag />
            <span
              aria-hidden="true"
              className="hidden text-border sm:inline-block"
            >
              /
            </span>
            <span className="hidden font-mono text-xs text-muted-foreground sm:inline-block">
              Curated Jobs
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <LogoutButton size="sm" variant="outline" />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-5 py-10 sm:px-8 md:py-12">
        <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div className="space-y-2">
            <Link
              href="/protected"
              className={buttonVariants({ variant: "ghost", size: "xs" })}
            >
              <ArrowLeft aria-hidden="true" />
              Dashboard
            </Link>
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Tailored <span className="text-aura-gradient">feed</span>
            </h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              Roles from Seek, Indeed and LinkedIn matched to your target job
              titles.
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
                  className="size-4 text-aura-secondary"
                />
              </div>
              <CardTitle className="text-lg">What are you looking for?</CardTitle>
              <CardDescription>
                Add up to {MAX_KEYWORDS} job titles, then hit{" "}
                <span className="font-medium text-foreground">Find jobs</span>.
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
                            className="inline-flex size-4 cursor-pointer items-center justify-center rounded-full hover:bg-primary/20"
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
              <h2 className="font-heading text-lg font-medium text-foreground">
                Matches
              </h2>
              <span className="font-mono text-xs text-muted-foreground">
                {feed.length} result{feed.length === 1 ? "" : "s"}
              </span>
            </div>

            {feed.length === 0 ? (
              <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border bg-background/45 p-6">
                <span className="inline-flex size-10 items-center justify-center rounded-xl border border-aura-primary/25 bg-primary/10 text-aura-primary">
                  <Briefcase aria-hidden="true" className="size-5" />
                </span>
                <p className="font-heading text-base font-medium text-foreground">
                  No jobs yet
                </p>
                <p className="max-w-md text-sm text-muted-foreground">
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
      </main>
    </div>
  );
}
