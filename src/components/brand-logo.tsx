import Link from "next/link";

import { cn } from "~/lib/utils";

interface BrandMarkProps {
  className?: string;
}

/** Geometric Aura Prism emblem for Aura Farmer. */
export function BrandMark({ className }: BrandMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-aura-primary/30 bg-primary/15 text-aura-primary shadow-xs",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="size-4.5"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M12 2.75L20 12L12 21.25L4 12L12 2.75Z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
        <path
          d="M12 7.25L15.75 12L12 16.75L8.25 12L12 7.25Z"
          fill="currentColor"
          fillOpacity="0.9"
        />
      </svg>
    </span>
  );
}

interface BrandLogoProps {
  href?: string;
  className?: string;
  showTag?: boolean;
}

/** Full Aura Farmer horizontal brand lockup. */
export function BrandLogo({
  href = "/",
  className,
  showTag = false,
}: BrandLogoProps) {
  const content = (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark />
      <span className="flex items-baseline gap-2">
        <span className="font-heading text-base font-semibold tracking-tight text-foreground">
          Aura Farmer
        </span>
        {showTag && (
          <span className="hidden rounded-full border border-border/80 bg-muted/70 px-2 py-0.5 font-mono text-[10px] font-medium tracking-wider text-muted-foreground uppercase sm:inline-block">
            Tailor &amp; Track
          </span>
        )}
      </span>
    </span>
  );

  if (!href) {
    return content;
  }

  return (
    <Link
      href={href}
      className="group inline-flex cursor-pointer items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {content}
    </Link>
  );
}
