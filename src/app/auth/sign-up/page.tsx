import type { Metadata } from "next";

import { AuthShell } from "~/components/auth-shell";
import { SignUpForm } from "~/components/sign-up-form";

export const metadata: Metadata = {
  title: "Create account",
  description:
    "Create your Aura Farmer account to auto-tailor your resumes and CVs and keep track of matched jobs.",
};

export default function Page() {
  return (
    <AuthShell
      eyebrow="Get started"
      headline="Tailor every resume and keep track of every role."
      subcopy="Create an account, upload your resume, and let Aura Farmer auto-tailor your CVs and keep track of the jobs you care about."
    >
      <SignUpForm />
    </AuthShell>
  );
}
