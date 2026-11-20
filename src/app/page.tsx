import Link from "next/link";

import { LogoutButton } from "~/components/logout-button";
import { buttonVariants } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { createClient } from "~/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  return (
    <main className="bg-background text-foreground flex min-h-svh items-center justify-center p-6 md:p-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg font-medium tracking-normal">
            Aura Farmer
          </CardTitle>
          <CardDescription>
            {user
              ? `Signed in as ${user.email ?? "authenticated user"}`
              : "Sign in or create an account to continue."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {user ? (
            <>
              <Link
                href="/protected"
                className={buttonVariants({ variant: "default" })}
              >
                Go to protected page
              </Link>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link
                href="/auth/login"
                className={buttonVariants({ variant: "default" })}
              >
                Sign in
              </Link>
              <Link
                href="/auth/sign-up"
                className={buttonVariants({ variant: "outline" })}
              >
                Sign up
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
