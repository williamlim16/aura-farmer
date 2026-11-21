import Link from "next/link";
import { ArrowLeft, FileText, Sparkles, Target } from "lucide-react";

import { AuraBackdrop } from "~/components/aura-backdrop";
import { BrandLogo } from "~/components/brand-logo";
import { ThemeToggle } from "~/components/theme-toggle";
import { Badge } from "~/components/ui/badge";

interface AuthShellProps {
  children: React.ReactNode;
  eyebrow?: string;
  headline?: string;
  subcopy?: string;
}

const HIGHLIGHTS = [
  {
    icon: FileText,
    title: "Upload your resume & CV",
    description:
      "Turn your existing resume into a structured profile that powers every tailored version.",
  },
  {
    icon: Sparkles,
    title: "Auto-tailor resumes & CVs",
    description:
      "Automatically adapt your resume and CV to match the skills and keywords of each role.",
  },
  {
    icon: Target,
    title: "Keep track of your jobs",
    description:
      "Curate, organize, and track every matched job opportunity from one clean workspace.",
  },
] as const;

/** Editorial split-screen layout shared across all Aura Farmer auth routes. */
export function AuthShell({
  children,
  eyebrow = "Aura Farmer Tailor & Track",
  headline = "Auto-tailor your resumes and keep track of every job.",
  subcopy = "Upload your resume, automatically tailor your CV for matched roles, and keep track of every job opportunity in one place.",
}: AuthShellProps) {
  return (
    <div className="relative flex min-h-svh flex-col lg:grid lg:grid-cols-[1.05fr_1fr]">
      <AuraBackdrop variant="subtle" />

      {/* Left Editorial Brand Panel (Desktop) */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border/80 bg-card/45 p-10 backdrop-blur-xl lg:flex xl:p-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
        >
          <div
            className="absolute -top-24 -left-24 h-80 w-80 rounded-full blur-[110px]"
            style={{ background: "var(--aura-glow-1)" }}
          />
          <div
            className="absolute right-[-10%] bottom-[-10%] h-72 w-72 rounded-full blur-[110px]"
            style={{ background: "var(--aura-glow-2)" }}
          />
        </div>

        <div className="flex items-center justify-between">
          <BrandLogo href="/" showTag />
          <Badge variant="outline" className="font-mono text-[11px]">
            v1.0
          </Badge>
        </div>

        <div className="my-auto max-w-md space-y-8 py-12">
          <div className="space-y-4">
            <Badge variant="default">{eyebrow}</Badge>
            <h1 className="font-heading text-3xl leading-[1.12] font-semibold tracking-tight text-balance text-foreground xl:text-4xl">
              {headline}
            </h1>
            <p className="text-base leading-relaxed text-muted-foreground">
              {subcopy}
            </p>
          </div>

          <ul className="space-y-3.5" aria-label="Platform highlights">
            {HIGHLIGHTS.map(({ icon: Icon, title, description }) => (
              <li
                key={title}
                className="flex items-start gap-3.5 rounded-xl border border-border/70 bg-background/45 p-3.5 backdrop-blur-md"
              >
                <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-aura-primary/25 bg-primary/10 text-aura-primary">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <div className="space-y-0.5">
                  <p className="font-heading text-sm font-medium text-foreground">
                    {title}
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between border-t border-border/70 pt-6 text-xs text-muted-foreground">
          <span>Aura Farmer</span>
          <span className="font-mono">Encrypted Auth · TLS</span>
        </div>
      </aside>

      {/* Right Interactive Auth Canvas */}
      <div className="flex min-h-svh flex-col">
        <header className="flex items-center justify-between px-6 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="lg:hidden">
              <BrandLogo href="/" />
            </div>
            <Link
              href="/"
              className="hidden cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:inline-flex"
            >
              <ArrowLeft aria-hidden="true" className="size-3.5" />
              Back to home
            </Link>
          </div>
          <ThemeToggle />
        </header>

        <main className="flex flex-1 items-center justify-center px-5 pt-2 pb-12 sm:px-8">
          <div className="w-full max-w-[420px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
