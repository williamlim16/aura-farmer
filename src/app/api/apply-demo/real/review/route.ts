import { exclusive, json, readRequest } from "~/server/apply-real/request";
import { resolveApplication, ResolveError } from "~/server/apply-real/resolve";
import { reviewApplication, reviewedFields } from "~/server/apply-real/run-real";
import { issueReviewToken, sha256 } from "~/server/apply-real/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** Resolve the real application form, fill it in cloud Chromium, read back, screenshot. Never submits. */
export async function POST(request: Request) {
  const r = await readRequest(request);
  if (r instanceof Response) return r;
  const resume = await r.resume();
  if (typeof resume === "string") return json(400, { error: resume });
  const profile = r.profile();
  if (typeof profile === "string") return json(400, { error: profile });
  let app;
  try {
    app = await resolveApplication(r.str("postingUrl"));
  } catch (e) {
    return json(400, { error: e instanceof ResolveError ? e.message : "Could not open that job posting." });
  }
  return exclusive(async () => {
    try {
      const ev = await reviewApplication({ app, profile, resume });
      const reviewToken = issueReviewToken({ applyUrl: app.applyUrl, resumeSha: sha256(resume.bytes), profileSha: sha256(JSON.stringify(profile)), fields: reviewedFields(ev.report) }, process.env.APPLY_DEMO_SECRET!);
      return json(200, { app, ...ev, reviewToken });
    } catch (e) {
      const m = e instanceof Error ? e.message.split("\n")[0] : String(e);
      console.error("[apply-real review]", m);
      return json(502, { error: `Could not fill the application page: ${m?.slice(0, 300)}` });
    }
  });
}
