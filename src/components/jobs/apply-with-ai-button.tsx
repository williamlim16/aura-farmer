"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";

import { buttonVariants } from "~/components/ui/button";
import { applyWithAiEnabled } from "~/lib/apply/flag";
import { cn } from "~/lib/utils";

/** Tracking-table entry point to the Apply with AI review. Hidden unless the feature is enabled. */
export function ApplyWithAiButton({ jobId, jobTitle }: { jobId: number; jobTitle: string }) {
  if (!applyWithAiEnabled()) return null;
  return (
    <Link
      href={`/jobs/apply/${jobId}`}
      aria-label={`Apply with AI: ${jobTitle}`}
      className={cn(buttonVariants({ variant: "outline", size: "xs" }), "mt-1.5")}
    >
      <Sparkles aria-hidden="true" />
      Apply with AI
    </Link>
  );
}
