"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";

import { startCompanySearchAction } from "~/app/jobs/companies/actions";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";

const PLACEHOLDER = `Describe your ideal company in your own words. For example:

• Location: Sydney or Melbourne, or fully remote within Australia
• Industry: fintech, health tech or climate; not gambling or defence
• Size & stage: start-up or scale-up, roughly 20–500 people
• Culture: flat structure, cross-functional teams, good mentoring for juniors
• Work: hybrid or remote; full-time or contract`;

/** Re-renders the page every few seconds while research is running. */
function useRefreshWhile(active: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(id);
  }, [active, router]);
}

export function PreferencesForm({
  defaultValue,
  running,
  progress,
}: {
  defaultValue: string;
  running: boolean;
  progress: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    startCompanySearchAction,
    null,
  );
  useRefreshWhile(running);
  const busy = running || pending;

  return (
    <form action={formAction} className="space-y-3">
      <Textarea
        name="preferences"
        defaultValue={defaultValue}
        placeholder={PLACEHOLDER}
        aria-label="Your ideal company"
        rows={8}
        required
        disabled={busy}
        className="min-h-48"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Sparkles aria-hidden="true" className="size-4" />
          )}
          {busy ? "Researching…" : "Find companies"}
        </Button>
        {running && progress && (
          <p role="status" className="text-muted-foreground text-xs">
            {progress}… (usually 2–4 minutes; you can leave this page)
          </p>
        )}
        {!running && state && (
          <p
            role="status"
            className={cn(
              "text-xs",
              state.ok ? "text-muted-foreground" : "text-destructive",
            )}
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
