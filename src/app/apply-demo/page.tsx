import { notFound } from "next/navigation";

import { ApplyDemo } from "~/components/apply-demo/apply-demo";
import { RealApplication } from "~/components/apply-demo/real-application";
import { APPLICATION_TARGETS } from "~/lib/applications/targets";
import { issueDemoToken } from "~/server/apply-demo/demo-token";
import { applyDemoEnabled } from "~/server/apply-demo/gate";
import { DEMO_PERSONAS } from "~/server/apply-demo/personas";

export const dynamic = "force-dynamic";

export default function ApplyDemoPage() {
  if (!applyDemoEnabled()) notFound();
  const forms = APPLICATION_TARGETS.filter((t) => t.key !== "trap").map((t) => ({ key: t.key, label: `${t.title} — ${t.company}`, description: t.description }));
  const token = issueDemoToken(process.env.APPLY_DEMO_SECRET!);
  const personas = Object.entries(DEMO_PERSONAS).map(([key, p]) => ({ key, label: p.label }));
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6 font-sans">
      <div>
        <h1 className="text-2xl font-semibold">Apply to a real job</h1>
        <p className="text-muted-foreground text-sm">
          A real Chromium runs inside this Vercel deployment: it opens the employer&apos;s Greenhouse or Lever application, fills it from your resume and your answers, reads every field back and shows you a screenshot. Nothing is sent until you press Confirm Submit, and nothing is stored.
        </p>
      </div>
      <RealApplication token={token} />
      <details className="rounded border p-4">
        <summary className="cursor-pointer font-medium">Synthetic test forms (fictional candidates, never submitted)</summary>
        <div className="mt-4">
          <ApplyDemo forms={forms} personas={personas} token={token} />
        </div>
      </details>
    </main>
  );
}
