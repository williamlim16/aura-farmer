import { notFound } from "next/navigation";

import { ApplyDemo } from "~/components/apply-demo/apply-demo";
import { APPLICATION_TARGETS } from "~/lib/applications/targets";
import { issueDemoToken } from "~/server/apply-demo/demo-token";
import { applyDemoEnabled } from "~/server/apply-demo/gate";
import { DEMO_PERSONAS } from "~/server/apply-demo/personas";

export const dynamic = "force-dynamic";

export default function ApplyDemoPage() {
  if (!applyDemoEnabled()) notFound();
  const forms = APPLICATION_TARGETS.filter((t) => t.key !== "trap").map((t) => ({ key: t.key, label: `${t.title} — ${t.company}`, description: t.description }));
  const personas = Object.entries(DEMO_PERSONAS).map(([key, p]) => ({ key, label: p.label }));
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6 font-sans">
      <div>
        <h1 className="text-2xl font-semibold">Apply Demo: cloud autofill</h1>
        <p className="text-muted-foreground text-sm">
          A real Chromium runs inside this Vercel deployment, opens a synthetic application form, fills it for a fictional candidate, reads every field back and returns a screenshot. Nothing is stored and nothing is submitted.
        </p>
      </div>
      <ApplyDemo forms={forms} personas={personas} token={issueDemoToken(process.env.APPLY_DEMO_SECRET!)} />
    </main>
  );
}
