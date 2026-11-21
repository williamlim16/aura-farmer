import Link from "next/link";

import { NewApplicationForm } from "~/components/apply/new-application-form";
import { buttonVariants } from "~/components/ui/button";
import { llmAvailability, requireUser } from "~/server/api/session";

export const dynamic = "force-dynamic";

export default async function NewApplicationPage() {
  const { userId, deps } = await requireUser();
  const profile = await deps.repos.profiles.get(userId);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Prepare an application</h1>
        <p className="text-muted-foreground text-sm">Your reviewed profile is used as-is. The form is filled for you to check; you always submit it yourself.</p>
      </div>
      {profile ? (
        <NewApplicationForm llm={llmAvailability()} />
      ) : (
        <p className="text-sm">
          You need a profile first.{" "}
          <Link href="/apply/profile" className={buttonVariants({ variant: "link" })}>Upload your resume</Link>
        </p>
      )}
    </div>
  );
}
