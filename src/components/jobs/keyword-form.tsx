"use client";

import { useActionState, useEffect, useRef } from "react";
import { Loader2, Plus } from "lucide-react";

import { addKeywordAction } from "~/app/jobs/actions";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

export function KeywordForm({ disabled }: { disabled?: boolean }) {
  const [state, formAction, pending] = useActionState(addKeywordAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <div className="flex gap-2">
        <Input
          name="keyword"
          placeholder="e.g. Frontend Developer"
          aria-label="Job title"
          autoComplete="off"
          required
          disabled={disabled === true || pending}
        />
        <Button type="submit" disabled={disabled === true || pending}>
          {pending ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Plus aria-hidden="true" className="size-4" />
          )}
          Add
        </Button>
      </div>
      {state && (
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
    </form>
  );
}
