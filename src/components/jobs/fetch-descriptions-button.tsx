"use client";

import { useRef, useState, useTransition } from "react";
import { FileText, Loader2 } from "lucide-react";

import { fetchDescriptionsAction } from "~/app/jobs/actions";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/**
 * Fetches job descriptions in batches until none are left. Each batch
 * revalidates the page, so descriptions fill into the table as they arrive.
 */
export function FetchDescriptionsButton({ missing }: { missing: number }) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const stopped = useRef(false);

  function run() {
    stopped.current = false;
    startTransition(async () => {
      let fetched = 0;
      for (;;) {
        const res = await fetchDescriptionsAction();
        if (!res.ok) {
          setStatus({ ok: false, text: res.message });
          return;
        }
        fetched += res.found;
        if (res.remaining === 0 || !res.progressed || stopped.current) {
          setStatus({
            ok: true,
            text:
              `Fetched ${fetched} description${fetched === 1 ? "" : "s"}.` +
              (res.remaining > 0
                ? ` ${res.remaining} still to go — run again to retry.`
                : ""),
          });
          return;
        }
        setStatus({
          ok: true,
          text: `Fetched ${fetched} so far — ${res.remaining} to go…`,
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
            <FileText aria-hidden="true" className="size-3.5" />
          )}
          {pending
            ? "Fetching descriptions..."
            : missing > 0
              ? `Fetch descriptions (${missing})`
              : "All descriptions fetched"}
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
