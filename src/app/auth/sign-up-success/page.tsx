import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, MailCheck } from "lucide-react";

import { AuthShell } from "~/components/auth-shell";
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
  title: "Confirm your email",
  description: "Verify your email address to activate your Aura Farmer account.",
};

export default function Page() {
  return (
    <AuthShell
      eyebrow="Almost there"
      headline="One quick check to activate auto-applying."
      subcopy="Confirm your email so you can upload your resume, explore curated job matches, and launch browser-automated applications."
    >
      <Card>
        <CardHeader className="space-y-3">
          <span className="inline-flex size-11 items-center justify-center rounded-xl border border-aura-secondary/30 bg-aura-secondary/12 text-aura-secondary">
            <MailCheck aria-hidden="true" className="size-5" />
          </span>
          <div className="space-y-1">
            <CardTitle className="text-2xl">Check your email</CardTitle>
            <CardDescription>
              Your Aura Farmer account has been created.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm leading-relaxed text-muted-foreground">
            We&apos;ve sent a confirmation link to your inbox. Open the link to
            verify your address before signing in.
          </p>
          <Link
            href="/auth/login"
            className={cn(
              buttonVariants({ variant: "default", size: "lg" }),
              "w-full",
            )}
          >
            Continue to sign in
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
