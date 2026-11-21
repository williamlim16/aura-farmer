import { cn } from "~/lib/utils";

interface AuraBackdropProps {
  className?: string;
  variant?: "default" | "subtle";
}

/** Atmospheric obsidian/light radial aura mesh and architectural grid backdrop. */
export function AuraBackdrop({
  className,
  variant = "default",
}: AuraBackdropProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none fixed inset-0 -z-10 overflow-hidden",
        className,
      )}
    >
      <div className="aura-grid absolute inset-0 mask-[radial-gradient(ellipse_75%_65%_at_50%_0%,#000_55%,transparent_100%)]" />
      <div
        className={cn(
          "absolute -top-36 left-1/2 -translate-x-1/2 rounded-full blur-[120px]",
          variant === "default"
            ? "h-[420px] w-[720px]"
            : "h-[320px] w-[540px] opacity-75",
        )}
        style={{ background: "var(--aura-glow-1)" }}
      />
      <div
        className={cn(
          "absolute top-28 right-[-8%] rounded-full blur-[120px]",
          variant === "default"
            ? "h-[340px] w-[420px]"
            : "h-[240px] w-[320px] opacity-65",
        )}
        style={{ background: "var(--aura-glow-2)" }}
      />
    </div>
  );
}
