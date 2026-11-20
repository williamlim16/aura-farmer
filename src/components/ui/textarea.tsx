import * as React from "react";
import { cn } from "~/lib/utils";

/** Accessible multi-line textarea styled consistently with Input primitives. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input bg-background/70 text-foreground placeholder:text-muted-foreground/75 hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-destructive/25 dark:bg-background/50 min-h-24 w-full min-w-0 rounded-lg border px-3.5 py-2.5 text-sm transition-[border-color,box-shadow,background-color] duration-200 outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-2",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
