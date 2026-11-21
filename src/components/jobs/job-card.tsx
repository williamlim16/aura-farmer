import { ExternalLink } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { JOB_SOURCES, RECENT_DAYS, type JobSource } from "~/server/job-boards";

export interface JobCardData {
  title: string;
  url: string;
  source: string;
  keyword: string;
  company: string | null;
  location: string | null;
  snippet: string | null;
  publishedAt: Date | null;
  fetchedAt: Date;
}

const dateFormat = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
});

/** "Posted today" / "Posted 3d ago". Indeed cards carry no date. */
export function postedLabel(job: Pick<JobCardData, "publishedAt">): string {
  if (!job.publishedAt) return `Posted within ${RECENT_DAYS}d`;
  const days = Math.floor(
    (Date.now() - job.publishedAt.getTime()) / 86_400_000,
  );
  return days < 1 ? "Posted today" : `Posted ${days}d ago`;
}

export function JobCard({ job }: { job: JobCardData }) {
  const sourceLabel = JOB_SOURCES[job.source as JobSource]?.label ?? job.source;

  return (
    <Card size="sm" className="h-full">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="teal">{sourceLabel}</Badge>
          <Badge variant="outline" className="max-w-[60%] truncate">
            {job.keyword}
          </Badge>
          <span
            className="text-muted-foreground ml-auto font-mono text-[11px]"
            title={`Last found ${dateFormat.format(job.fetchedAt)}`}
          >
            {postedLabel(job)}
          </span>
        </div>
        <CardTitle className="line-clamp-2 text-base leading-snug">
          {job.title}
        </CardTitle>
        {(job.company ?? job.location) && (
          <p className="text-muted-foreground line-clamp-1 text-xs">
            {[job.company, job.location].filter(Boolean).join(" · ")}
          </p>
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-4">
        {job.snippet && (
          <p className="text-muted-foreground line-clamp-3 text-xs leading-relaxed">
            {job.snippet}
          </p>
        )}
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({
            variant: "outline",
            size: "sm",
            className: "w-fit",
          })}
        >
          View posting
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </a>
      </CardContent>
    </Card>
  );
}
