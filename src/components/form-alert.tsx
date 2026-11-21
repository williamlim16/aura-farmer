import { AlertCircle, CheckCircle2 } from "lucide-react";

import { cn } from "~/lib/utils";

interface FormAlertProps {
  message: string;
  variant?: "error" | "success";
  className?: string;
}

/** Accessible inline status alert with icon and ARIA live announcement. */
export function FormAlert({
  message,
  variant = "error",
  className,
}: FormAlertProps) {
  const isError = variant === "error";

  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live="polite"
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm leading-snug",
        isError
          ? "border-destructive/35 bg-destructive/10 text-destructive"
          : "border-aura-secondary/35 bg-aura-secondary/10 text-aura-secondary",
        className,
      )}
    >
      {isError ? (
        <AlertCircle
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0"
        />
      ) : (
        <CheckCircle2
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0"
        />
      )}
      <span>{message}</span>
    </div>
  );
}
