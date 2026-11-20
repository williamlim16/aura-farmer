import type { Metadata } from "next";

import { AuthShell } from "~/components/auth-shell";
import { ForgotPasswordForm } from "~/components/forgot-password-form";

export const metadata: Metadata = {
  title: "Reset password",
  description: "Request a password reset link for your Aura Farmer account.",
};

export default function Page() {
  return (
    <AuthShell
      eyebrow="Account recovery"
      headline="Back to your job applications in moments."
      subcopy="We'll send a one-time recovery link straight to your inbox so you can set a fresh password securely."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
