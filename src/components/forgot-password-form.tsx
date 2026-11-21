"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";

import { FormAlert } from "~/components/form-alert";
import { Button, buttonVariants } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { createClient } from "~/lib/supabase/client";
import { cn } from "~/lib/utils";

export function ForgotPasswordForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/update-password`,
      });
      if (error) throw error;
      setSuccess(true);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      {success ? (
        <Card>
          <CardHeader className="space-y-3">
            <span className="inline-flex size-11 items-center justify-center rounded-xl border border-aura-secondary/30 bg-aura-secondary/12 text-aura-secondary">
              <MailCheck aria-hidden="true" className="size-5" />
            </span>
            <div className="space-y-1">
              <CardTitle className="text-2xl">Check your email</CardTitle>
              <CardDescription>
                Password reset instructions have been sent.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm leading-relaxed text-muted-foreground">
              If an account exists for{" "}
              <span className="font-medium text-foreground">{email}</span>, you
              will receive a link to reset your password shortly.
            </p>
            <Link
              href="/auth/login"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "w-full",
              )}
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              Return to sign in
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="space-y-1.5">
            <CardTitle className="text-2xl">Reset your password</CardTitle>
            <CardDescription>
              Enter your email address and we&apos;ll send you a secure recovery
              link.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                  disabled={isLoading}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              {error && <FormAlert message={error} />}

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2
                      aria-hidden="true"
                      className="size-4 animate-spin"
                    />
                    Sending reset link...
                  </>
                ) : (
                  "Send reset link"
                )}
              </Button>
            </form>

            <p className="text-center text-sm text-muted-foreground">
              Remembered your password?{" "}
              <Link
                href="/auth/login"
                className="cursor-pointer font-medium text-aura-primary underline-offset-4 transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
