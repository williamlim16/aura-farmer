"use client";

import { useActionState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { refreshJobsAction } from "~/app/jobs/actions";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export function RefreshJobsButton({ disabled }: { disabled?: boolean }) {
  const [state, formAction, pending] = useActionState(refreshJobsAction, null);

  return (
    <form action={formAction} className="flex flex-col items-start gap-2 sm:items-end">
      <Button type="submit" size="sm" disabled={disabled === true || pending}>
        {pending ? (
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw aria-hidden="true" className="size-3.5" />
        )}
        {pending ? "Searching job boards..." : "Find jobs"}
      </Button>
      {state && (
        <p
          role="status"
          className={cn(
            "max-w-sm text-xs sm:text-right",
            state.ok ? "text-muted-foreground" : "text-destructive",
          )}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
