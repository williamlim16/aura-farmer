import type { Metadata } from "next";

import { AuthShell } from "~/components/auth-shell";
import { LoginForm } from "~/components/login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Aura Farmer job automation dashboard.",
};

export default function Page() {
  return (
    <AuthShell
      eyebrow="Sign in"
      headline="Pick up your job search right where you left off."
      subcopy="Sign in to review your curated job matches and track your automated browser applications."
    >
      <LoginForm />
    </AuthShell>
  );
}
