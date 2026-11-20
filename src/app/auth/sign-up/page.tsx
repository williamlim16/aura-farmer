import type { Metadata } from "next";

import { AuthShell } from "~/components/auth-shell";
import { SignUpForm } from "~/components/sign-up-form";

export const metadata: Metadata = {
  title: "Create account",
  description:
    "Create your Aura Farmer account to curate matched jobs and apply automatically.",
};

export default function Page() {
  return (
    <AuthShell
      eyebrow="Get started"
      headline="Land more interviews without the portal grind."
      subcopy="Create an account, upload your resume, and let Aura Farmer curate tailored roles and click through job portals for you."
    >
      <SignUpForm />
    </AuthShell>
  );
}
