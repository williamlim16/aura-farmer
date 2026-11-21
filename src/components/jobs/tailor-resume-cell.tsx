"use client";

import { useState, useTransition } from "react";
import {
  Download,
  FileCode2,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import {
  compileTailoredResumeAction,
  tailorResumeAction,
} from "~/app/jobs/actions";
import { Button, buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import type { TailoredResumeStatus } from "~/server/tailored-resumes";

/**
 * Resume column of the Tracking table: tailor a resume to the job, then
 * download it as PDF / .tex. Tailoring takes up to a minute (LLM + compile).
 */
export function TailorResumeCell({
  jobId,
  jobTitle,
  hasDescription,
  status,
}: {
  jobId: number;
  jobTitle: string;
  hasDescription: boolean;
  status: TailoredResumeStatus | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [pendingLabel, setPendingLabel] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  function run(
    label: string,
    action: () => Promise<{ ok: boolean; pdf: boolean; message: string }>,
  ) {
    setNotice(null);
    setPendingLabel(label);
    startTransition(async () => {
      const result = await action();
      // Success with a PDF needs no message: the download links appear.
      if (!result.ok || !result.pdf) {
        setNotice({ ok: result.ok, text: result.message });
      }
    });
  }

  function tailor() {
    if (
      status &&
      !window.confirm(
        `Re-tailor your resume for "${jobTitle}"? This replaces the current one.`,
      )
    ) {
      return;
    }
    run("Tailoring…", () => tailorResumeAction(jobId));
  }

  const href = (format: "pdf" | "tex") =>
    `/api/tailored-resumes/${jobId}?format=${format}&v=${status?.updatedAt ?? 0}`;

  let body: React.ReactNode;
  if (isPending) {
    body = (
      <span
        className="text-muted-foreground inline-flex items-center gap-1.5 text-xs whitespace-nowrap"
        role="status"
      >
        <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
        {pendingLabel}
      </span>
    );
  } else if (!status) {
    body = (
      <Button
        variant="outline"
        size="sm"
        onClick={tailor}
        disabled={!hasDescription}
        title={
          hasDescription
            ? "Tailor your resume to this job"
            : "No job description yet. Use “Fetch descriptions” in All jobs first."
        }
      >
        <Sparkles aria-hidden="true" className="size-3.5" />
        Tailor
      </Button>
    );
  } else {
    body = (
      <div className="flex items-center gap-1">
        {status.hasPdf ? (
          <a
            href={href("pdf")}
            target="_blank"
            rel="noopener"
            className={buttonVariants({ variant: "default", size: "sm" })}
            aria-label={`Open tailored resume PDF for ${jobTitle}`}
          >
            <Download aria-hidden="true" className="size-3.5" />
            PDF
          </a>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              run("Compiling…", () => compileTailoredResumeAction(jobId))
            }
            title={status.compileError ?? "Compile the PDF"}
          >
            <RefreshCw aria-hidden="true" className="size-3.5" />
            Retry PDF
          </Button>
        )}
        <a
          href={href("tex")}
          className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          aria-label={`Download LaTeX source for ${jobTitle}`}
          title="Download .tex"
        >
          <FileCode2 aria-hidden="true" className="size-3.5" />
        </a>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={tailor}
          disabled={!hasDescription}
          aria-label={`Re-tailor resume for ${jobTitle}`}
          title="Re-tailor"
        >
          <Sparkles aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
    );
  }

  const message =
    notice?.text ??
    (!isPending && status && !status.hasPdf ? status.compileError : null);

  return (
    <div className="flex flex-col items-start gap-1">
      {body}
      {message && (
        <p
          role={notice && !notice.ok ? "alert" : undefined}
          className={cn(
            "max-w-48 text-[11px] leading-snug",
            notice && !notice.ok ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {message}
        </p>
      )}
    </div>
  );
}
