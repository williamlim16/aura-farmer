import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CheckCircle2,
  FileText,
  Home,
  KeyRound,
  MousePointerClick,
  ShieldCheck,
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

export const metadata: Metadata = {
  title: "Dashboard",
  description:
    "Manage your resume, curated job matches, and automated browser applications.",
};

export default async function ProtectedPage() {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  const email =
    typeof data.claims.email === "string"
      ? data.claims.email
      : "Authenticated user";
  const handle = email.includes("@") ? (email.split("@")[0] ?? email) : email;

  return (
    <div className="relative flex min-h-svh flex-col overflow-x-clip">
      <AuraBackdrop variant="subtle" />

      {/* Top Workspace Header */}
      <header className="glass-nav sticky top-0 z-40">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <BrandLogo href="/" showTag />
            <span
              aria-hidden="true"
              className="hidden text-border sm:inline-block"
            >
              /
            </span>
            <span className="hidden font-mono text-xs text-muted-foreground sm:inline-block">
              Overview
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <Badge
              variant="outline"
              className="hidden max-w-[220px] truncate font-mono text-xs md:inline-flex"
            >
              {email}
            </Badge>
            <ThemeToggle />
            <LogoutButton size="sm" variant="outline" />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-5 py-10 sm:px-8 md:py-12">
        {/* Welcome Strip */}
        <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div className="space-y-2">
            <Badge variant="teal">
              <CheckCircle2 aria-hidden="true" className="size-3.5" />
              Session active
            </Badge>
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Welcome back, <span className="text-aura-gradient">{handle}</span>
            </h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              Upload your resume to curate tailored job matches and launch
              automated browser applications.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href="/"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Home aria-hidden="true" className="size-3.5" />
              Landing page
            </Link>
            <Link
              href="/auth/update-password"
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <KeyRound aria-hidden="true" className="size-3.5" />
              Update password
            </Link>
          </div>
        </section>

        {/* Summary Status Cards */}
        <section
          aria-label="Dashboard overview"
          className="grid gap-4 sm:grid-cols-3"
        >
          <Card size="sm">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardDescription className="font-mono text-xs uppercase">
                  Resume Profile
                </CardDescription>
                <FileText
                  aria-hidden="true"
                  className="size-4 text-aura-primary"
                />
              </div>
              <CardTitle className="text-xl">Awaiting upload</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Upload your resume to extract skills, roles, and work history.
              </p>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardDescription className="font-mono text-xs uppercase">
                  Curated Jobs
                </CardDescription>
                <Target
                  aria-hidden="true"
                  className="size-4 text-aura-secondary"
                />
              </div>
              <CardTitle className="text-xl">Tailored feed</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Roles matched to your background, ready to apply from one place.
              </p>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardDescription className="font-mono text-xs uppercase">
                  Browser Automation
                </CardDescription>
                <MousePointerClick
                  aria-hidden="true"
                  className="size-4 text-aura-primary"
                />
              </div>
              <CardTitle className="text-xl">Portal agent</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Clicks through external job portals and submits applications for
                you.
              </p>
            </CardContent>
          </Card>
        </section>

        {/* Main Auto-Apply Pipeline & Account Security */}
        <section className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <Card className="flex flex-col justify-between">
            <CardHeader>
              <Badge variant="default" className="w-fit">
                Pipeline
              </Badge>
              <CardTitle className="text-xl">Auto-Apply Pipeline</CardTitle>
              <CardDescription>
                Upload your resume, review curated job matches, and apply
                directly while our browser automation clicks through job
                portals.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-border bg-background/45 p-6">
                <span className="inline-flex size-10 items-center justify-center rounded-xl border border-aura-primary/25 bg-primary/10 text-aura-primary">
                  <Sparkles aria-hidden="true" className="size-5" />
                </span>
                <div className="space-y-1">
                  <p className="font-heading text-base font-medium text-foreground">
                    Upload your resume to get started
                  </p>
                  <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                    Once your resume is uploaded, Aura Farmer will curate a
                    personalized list of matching jobs and let you apply
                    directly through the platform using automated browser
                    sessions.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="font-mono uppercase">
                  Security
                </Badge>
                <ShieldCheck
                  aria-hidden="true"
                  className="size-4 text-aura-secondary"
                />
              </div>
              <CardTitle className="text-xl">Account &amp; Session</CardTitle>
              <CardDescription>
                Manage your active credentials and session security.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="space-y-3 rounded-xl border border-border/75 bg-background/45 p-4 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="truncate font-mono text-xs text-foreground">
                    {email}
                  </dd>
                </div>
                <div className="h-px bg-border/70" />
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="font-mono text-xs text-aura-secondary">
                    Authenticated
                  </dd>
                </div>
              </dl>

              <div className="flex flex-col gap-2.5">
                <Link
                  href="/auth/update-password"
                  className={buttonVariants({
                    variant: "outline",
                    size: "default",
                    className: "w-full",
                  })}
                >
                  <KeyRound aria-hidden="true" className="size-4" />
                  Change password
                </Link>
                <LogoutButton
                  variant="destructive"
                  size="default"
                  className="w-full"
                />
              </div>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
