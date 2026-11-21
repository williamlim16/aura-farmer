import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AuraBackdrop } from "~/components/aura-backdrop";
import { BrandLogo } from "~/components/brand-logo";
import { JobsTabs } from "~/components/jobs/jobs-tabs";
import { LogoutButton } from "~/components/logout-button";
import { ThemeToggle } from "~/components/theme-toggle";
import { buttonVariants } from "~/components/ui/button";

export default function JobsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-svh flex-col overflow-x-clip">
      <AuraBackdrop variant="subtle" />

      <header className="glass-nav sticky top-0 z-40">
        <div className="flex h-16 w-full items-center justify-between gap-4 px-5 sm:px-8 lg:px-10">
          <div className="flex items-center gap-3">
            <BrandLogo href="/" showTag />
            <span
              aria-hidden="true"
              className="text-border hidden sm:inline-block"
            >
              /
            </span>
            <span className="text-muted-foreground hidden font-mono text-xs sm:inline-block">
              Curated Jobs
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <LogoutButton size="sm" variant="outline" />
          </div>
        </div>
      </header>

      <main className="flex w-full flex-1 flex-col gap-8 px-5 py-10 sm:px-8 md:py-12 lg:px-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/profile"
            className={buttonVariants({ variant: "ghost", size: "xs" })}
          >
            <ArrowLeft aria-hidden="true" />
            Profile
          </Link>
          <JobsTabs />
        </div>
        {children}
      </main>
    </div>
  );
}
