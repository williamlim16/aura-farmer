import type { Metadata } from "next";

import { AuthShell } from "~/components/auth-shell";
import { UpdatePasswordForm } from "~/components/update-password-form";

export const metadata: Metadata = {
  title: "Update password",
  description: "Set a new password for your Aura Farmer account.",
};

export default function Page() {
  return (
    <AuthShell
      eyebrow="Security update"
      headline="Set a fresh password for your account."
      subcopy="Choose a strong, unique password to keep your resume profile and automated application sessions secure."
    >
      <UpdatePasswordForm />
    </AuthShell>
  );
}
