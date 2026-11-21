import { notFound, redirect } from "next/navigation";

import { ApplyDemo } from "~/components/apply-demo/apply-demo";
import { APPLICATION_TARGETS } from "~/lib/applications/targets";
import { currentUserId } from "~/server/api/next";
import { applyDemoEnabled } from "~/server/apply-demo/gate";
import { DEMO_ATS } from "~/server/apply-demo/run-demo";

export const dynamic = "force-dynamic";

export default async function ApplyDemoPage() {
  if (!applyDemoEnabled()) notFound();
  if (!(await currentUserId())) redirect("/auth/login?next=/apply-demo");
  const forms = APPLICATION_TARGETS.filter((t) => t.key !== "trap").map((t) => ({ key: t.key, label: `${t.title} — ${t.company}`, description: t.description }));
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6 font-sans">
      <div>
        <h1 className="text-2xl font-semibold">Apply Demo: cloud autofill</h1>
        <p className="text-muted-foreground text-sm">
          A real Chromium runs on the server, opens the form, fills it from the candidate details, reads every field back and returns a screenshot. Nothing is stored and nothing is submitted: submit events and non-GET requests are blocked.
        </p>
      </div>
      <ApplyDemo forms={forms} atsHosts={Object.keys(DEMO_ATS)} />
    </main>
  );
}
