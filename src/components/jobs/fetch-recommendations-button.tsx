"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";

import { fetchRecommendationsAction } from "~/app/jobs/actions";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/**
 * Researches tracked companies in batches via Tavily until none are left.
 * Each batch revalidates the page, so recommendations fill in as they arrive.
 */
export function FetchRecommendationsButton({ missing }: { missing: number }) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const stopped = useRef(false);

  function run() {
    stopped.current = false;
    startTransition(async () => {
      let researched = 0;
      for (;;) {
        const res = await fetchRecommendationsAction();
        if (!res.ok) {
          setStatus({ ok: false, text: res.message });
          return;
        }
        researched += res.found;
        if (res.remaining === 0 || !res.progressed || stopped.current) {
          setStatus({
            ok: true,
            text:
              `Researched ${researched} role${researched === 1 ? "" : "s"}.` +
              (res.remaining > 0
                ? ` ${res.remaining} still to go — run again to retry.`
                : ""),
          });
          return;
        }
        setStatus({
          ok: true,
          text: `Researched ${researched} so far — ${res.remaining} to go…`,
        });
      }
    });
  }

  if (missing === 0 && !pending && !status) return null;

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex items-center gap-2">
        {pending && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => (stopped.current = true)}
          >
            Stop
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={run}
          disabled={pending || missing === 0}
        >
          {pending ? (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          ) : (
            <Sparkles aria-hidden="true" className="size-3.5" />
          )}
          {pending
            ? "Researching companies..."
            : missing > 0
              ? `Research companies (${missing})`
              : "All companies researched"}
        </Button>
      </div>
      {status && (
        <p
          role="status"
          className={cn(
            "max-w-sm text-xs sm:text-right",
            status.ok ? "text-muted-foreground" : "text-destructive",
          )}
        >
          {status.text}
        </p>
      )}
    </div>
  );
}
