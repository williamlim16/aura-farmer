"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Rss, Table2 } from "lucide-react";

import { cn } from "~/lib/utils";

const TABS = [
  { href: "/jobs", label: "Feed", icon: Rss },
  { href: "/jobs/all", label: "All jobs", icon: Table2 },
] as const;

export function JobsTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Jobs views"
      className="glass-surface inline-flex w-fit items-center gap-1 rounded-xl p-1"
    >
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
              active
                ? "bg-primary/12 text-aura-primary"
                : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" className="size-3.5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
