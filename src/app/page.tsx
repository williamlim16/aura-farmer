import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Command,
  FileText,
  MousePointerClick,
  Sparkles,
  Target,
} from "lucide-react";

import { AuraBackdrop } from "~/components/aura-backdrop";
import { BrandLogo } from "~/components/brand-logo";
import { LogoutButton } from "~/components/logout-button";
import { ThemeToggle } from "~/components/theme-toggle";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { createClient } from "~/lib/supabase/server";
import { cn } from "~/lib/utils";

const CAPABILITIES = [
  {
    icon: FileText,
    label: "01 · Resume Ingest",
    title: "Upload your resume once",
    description:
      "Drop in your resume and let Aura Farmer extract your skills, work history, and target roles into a structured candidate profile.",
  },
  {
    icon: Target,
    label: "02 · Smart Curation",
    title: "Curated jobs that fit you",
    description:
      "We continuously curate and rank open roles tailored to your background so you only spend time on relevant opportunities.",
  },
  {
    icon: MousePointerClick,
    label: "03 · Browser Automation",
    title: "Direct portal auto-apply",
    description:
      "Apply directly through the platform while our automated browser agent clicks through job portals, fills fields, and submits applications for you.",
  },
] as const;

const PREVIEW_MODULES = [
  {
    icon: FileText,
    title: "1. Resume Profile",
    meta: "Skills & experience parsed",
    status: "Ready",
  },
  {
    icon: Target,
    title: "2. Curated Matches",
    meta: "Tailored roles ranked for you",
    status: "Matched",
  },
  {
    icon: MousePointerClick,
    title: "3. Browser Auto-Apply",
    meta: "Portal forms filled & clicked",
    status: "Automated",
  },
] as const;

export default async function HomePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  return (
    <div className="relative flex min-h-svh flex-col overflow-x-clip">
      <AuraBackdrop />

      {/* Sticky Glass Navigation */}
      <header className="glass-nav sticky top-0 z-40">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <BrandLogo href="/" showTag />

          <nav
            aria-label="Primary navigation"
            className="hidden items-center gap-6 text-sm text-muted-foreground md:flex"
          >
            <a
              href="#overview"
              className="cursor-pointer transition-colors hover:text-foreground"
            >
              Overview
            </a>
            <a
              href="#capabilities"
              className="cursor-pointer transition-colors hover:text-foreground"
            >
              Capabilities
            </a>
          </nav>

          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            {user ? (
              <>
                <Link
                  href="/profile"
                  className={buttonVariants({ variant: "default", size: "sm" })}
                >
                  Open profile
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                </Link>
                <LogoutButton
                  size="sm"
                  variant="outline"
                  className="hidden sm:inline-flex"
                />
              </>
            ) : (
              <>
                <Link
                  href="/auth/login"
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "sm" }),
                    "hidden sm:inline-flex",
                  )}
                >
                  Sign in
                </Link>
                <Link
                  href="/auth/sign-up"
                  className={buttonVariants({ variant: "default", size: "sm" })}
                >
                  Get started
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section
          id="overview"
          className="mx-auto max-w-6xl px-5 pt-16 pb-16 sm:px-8 md:pt-24 md:pb-24"
        >
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 flex justify-center">
              <Badge variant="default" className="px-3 py-1">
                <Sparkles aria-hidden="true" className="size-3.5" />
                <span>
                  {user
                    ? `Signed in as ${user.email ?? "authenticated user"}`
                    : "Automated Job Application Platform"}
                </span>
              </Badge>
            </div>

            <h1 className="font-heading text-4xl leading-[1.08] font-semibold tracking-tight text-balance text-foreground sm:text-5xl md:text-6xl">
              Upload your resume. We curate and{" "}
              <span className="text-aura-gradient">auto-apply for you</span>.
            </h1>

            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Drop in your resume to get a personalized list of roles matched to
              your experience—then apply directly through Aura Farmer while our
              browser automation clicks through job portals on your behalf.
            </p>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-3.5">
              {user ? (
                <>
                  <Link
                    href="/profile"
                    className={buttonVariants({ variant: "default", size: "lg" })}
                  >
                    Open profile
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                  <LogoutButton variant="outline" size="lg" />
                </>
              ) : (
                <>
                  <Link
                    href="/auth/sign-up"
                    className={buttonVariants({ variant: "default", size: "lg" })}
                  >
                    Start auto-applying
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                  <Link
                    href="/auth/login"
                    className={buttonVariants({ variant: "outline", size: "lg" })}
                  >
                    Sign in
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* Editorial Glass Workspace Preview */}
          <div className="mx-auto mt-14 max-w-4xl md:mt-18">
            <div className="glass-surface overflow-hidden rounded-2xl">
              {/* Top Window Bar */}
              <div className="flex items-center justify-between border-b border-border/80 bg-muted/35 px-4 py-3 sm:px-6">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-full bg-border"
                  />
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-full bg-border"
                  />
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-full bg-border"
                  />
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    aura-farmer / auto-apply-pipeline
                  </span>
                </div>
                <div className="hidden items-center gap-1.5 rounded-md border border-border/80 bg-background/60 px-2.5 py-1 font-mono text-[11px] text-muted-foreground sm:inline-flex">
                  <Command aria-hidden="true" className="size-3" />
                  <span>Browser agent active</span>
                </div>
              </div>

              {/* Preview Body */}
              <div className="grid gap-4 p-5 sm:grid-cols-3 sm:p-6">
                {PREVIEW_MODULES.map((item) => (
                  <div
                    key={item.title}
                    className="flex flex-col justify-between gap-4 rounded-xl border border-border/75 bg-background/55 p-4 transition-colors duration-200 hover:border-aura-primary/35"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="inline-flex size-8 items-center justify-center rounded-lg border border-aura-primary/25 bg-primary/10 text-aura-primary">
                        <item.icon aria-hidden="true" className="size-4" />
                      </span>
                      <Badge variant="teal" className="font-mono text-[11px]">
                        <CheckCircle2 aria-hidden="true" className="size-3" />
                        {item.status}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      <p className="font-heading text-sm font-semibold text-foreground">
                        {item.title}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {item.meta}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Capabilities Bento Section */}
        <section
          id="capabilities"
          className="mx-auto max-w-6xl px-5 py-14 sm:px-8 md:py-20"
        >
          <div className="mb-10 max-w-xl space-y-2.5">
            <Badge variant="outline" className="font-mono uppercase">
              How It Works
            </Badge>
            <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              From resume upload to submitted applications—on autopilot.
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
              Skip repetitive portal forms and endless job boards. Aura Farmer
              pairs resume-driven job curation with real browser automation so
              you can apply without the manual grind.
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            {CAPABILITIES.map(({ icon: Icon, label, title, description }) => (
              <Card
                key={title}
                className="transition-colors duration-200 hover:border-aura-primary/35"
              >
                <CardHeader className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex size-10 items-center justify-center rounded-xl border border-aura-primary/25 bg-primary/12 text-aura-primary">
                      <Icon aria-hidden="true" className="size-5" />
                    </span>
                    <span className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
                      {label}
                    </span>
                  </div>
                  <CardTitle className="text-lg">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="leading-relaxed">
                    {description}
                  </CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Bottom CTA Section */}
        <section className="mx-auto max-w-6xl px-5 pt-6 pb-20 sm:px-8 md:pb-24">
          <Card className="relative overflow-hidden">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-20 -right-20 h-64 w-64 rounded-full blur-[90px]"
              style={{ background: "var(--aura-glow-1)" }}
            />
            <CardContent className="flex flex-col items-start justify-between gap-6 py-2 md:flex-row md:items-center">
              <div className="max-w-xl space-y-2">
                <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  {user
                    ? "Your auto-apply dashboard is ready."
                    : "Ready to put your job search on autopilot?"}
                </h2>
                <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
                  {user
                    ? "Jump straight into your dashboard to manage your resume, curated jobs, and automated applications."
                    : "Create an account, upload your resume, and start applying to curated roles directly through the platform."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {user ? (
                  <Link
                    href="/profile"
                    className={buttonVariants({ variant: "default", size: "lg" })}
                  >
                    Open profile
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                ) : (
                  <>
                    <Link
                      href="/auth/sign-up"
                      className={buttonVariants({
                        variant: "default",
                        size: "lg",
                      })}
                    >
                      Create account
                      <ArrowRight aria-hidden="true" className="size-4" />
                    </Link>
                    <Link
                      href="/auth/login"
                      className={buttonVariants({
                        variant: "outline",
                        size: "lg",
                      })}
                    >
                      Sign in
                    </Link>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </section>
      </main>

      {/* Minimal Footer */}
      <footer className="border-t border-border/80 bg-card/30 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-6 text-xs text-muted-foreground sm:flex-row sm:px-8">
          <BrandLogo href="/" />
          <p className="font-mono">
            Aura Farmer · Resume-curated jobs &amp; browser-automated applications
          </p>
        </div>
      </footer>
    </div>
  );
}
