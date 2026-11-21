import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, RotateCcw, ShieldAlert } from "lucide-react";

import { AuthShell } from "~/components/auth-shell";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { cn } from "~/lib/utils";

export const metadata: Metadata = {
  title: "Authentication error",
  description: "Something went wrong during authentication.",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <AuthShell
      eyebrow="Authentication"
      headline="We hit a snag verifying your session."
      subcopy="Don't worry—you can retry signing in to return to your curated jobs and applications anytime."
    >
      <Card>
        <CardHeader className="space-y-3">
          <span className="inline-flex size-11 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/12 text-destructive">
            <ShieldAlert aria-hidden="true" className="size-5" />
          </span>
          <div className="space-y-1">
            <CardTitle className="text-2xl">Something went wrong</CardTitle>
            <CardDescription>
              We couldn&apos;t complete your authentication request.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {params?.error ? (
            <div
              role="alert"
              className="space-y-1.5 rounded-xl border border-destructive/25 bg-destructive/8 p-3.5"
            >
              <Badge variant="destructive" className="font-mono text-[11px]">
                Error details
              </Badge>
              <p className="font-mono text-xs break-words text-foreground">
                {params.error}
              </p>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              An unspecified authentication error occurred. Please try again.
            </p>
          )}

          <div className="flex flex-col gap-2.5 sm:flex-row">
            <Link
              href="/auth/login"
              className={cn(
                buttonVariants({ variant: "default", size: "lg" }),
                "flex-1",
              )}
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              Try again
            </Link>
            <Link
              href="/"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "flex-1",
              )}
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back home
            </Link>
          </div>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
