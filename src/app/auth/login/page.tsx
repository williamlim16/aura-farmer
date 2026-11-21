import type { Metadata } from "next";

import { AuthShell } from "~/components/auth-shell";
import { LoginForm } from "~/components/login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to your Aura Farmer resume tailoring and job tracking workspace.",
};

export default function Page() {
  return (
    <AuthShell
      eyebrow="Sign in"
      headline="Pick up your job search right where you left off."
      subcopy="Sign in to auto-tailor your resumes and CVs and keep track of your curated job matches."
    >
      <LoginForm />
    </AuthShell>
  );
}
