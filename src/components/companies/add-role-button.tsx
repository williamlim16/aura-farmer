"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Plus } from "lucide-react";

import { addCompanyRoleAction } from "~/app/jobs/companies/actions";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export function AddRoleButton({
  companyIndex,
  roleIndex,
}: {
  companyIndex: number;
  roleIndex: number;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={pending || state?.ok === true}
        onClick={() =>
          startTransition(async () => {
            setState(await addCompanyRoleAction(companyIndex, roleIndex));
          })
        }
      >
        {pending ? (
          <Loader2 aria-hidden="true" className="size-3 animate-spin" />
        ) : state?.ok ? (
          <Check aria-hidden="true" className="size-3" />
        ) : (
          <Plus aria-hidden="true" className="size-3" />
        )}
        {state?.ok ? "Tracking" : "Add to jobs"}
      </Button>
      {state && (
        <p
          role="status"
          className={cn(
            "max-w-56 text-right text-[11px]",
            state.ok ? "text-muted-foreground" : "text-destructive",
          )}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
