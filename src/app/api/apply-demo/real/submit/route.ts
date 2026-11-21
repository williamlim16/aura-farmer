import { exclusive, json, readRequest } from "~/server/apply-real/request";
import { applyUrlFor } from "~/server/apply-real/resolve";
import { submitApplication } from "~/server/apply-real/run-real";
import { readReviewToken, sha256 } from "~/server/apply-real/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const used = ((globalThis as unknown as { __afUsedReviews?: Set<string> }).__afUsedReviews ??= new Set<string>());

/**
 * Submit ONE reviewed application to the real employer, only with:
 * the user's explicit confirmation, a valid review token, and the exact same
 * resume, profile/answers and application URL that were reviewed.
 */
export async function POST(request: Request) {
  const r = await readRequest(request);
  if (r instanceof Response) return r;
  if (r.str("confirm") !== "SUBMIT") return json(400, { error: "Explicit confirmation is required." });
  const state = readReviewToken(r.str("reviewToken"), process.env.APPLY_DEMO_SECRET!);
  if (!state) return json(401, { error: "The review expired or is invalid. Run the review again." });
  const resume = await r.resume();
  if (typeof resume === "string") return json(400, { error: resume });
  const profile = r.profile();
  if (typeof profile === "string") return json(400, { error: profile });
  if (sha256(resume.bytes) !== state.resumeSha || sha256(JSON.stringify(profile)) !== state.profileSha) {
    return json(409, { error: "Your resume or answers changed since the review. Run the review again before submitting." });
  }
  const app = applyUrlFor(state.applyUrl);
  if (app?.applyUrl !== state.applyUrl) return json(400, { error: "Unsupported application URL." });
  const sig = r.str("reviewToken").split(".")[1]!;
  if (used.has(sig)) return json(409, { error: "This reviewed application was already sent for submission. Run a new review if needed." });
  return exclusive(async () => {
    used.add(sig);
    try {
      const out = await submitApplication({ app, profile, resume }, state);
      return json(200, { app, ...out });
    } catch (e) {
      const m = e instanceof Error ? e.message.split("\n")[0] : String(e);
      console.error("[apply-real submit]", m);
      // Failed before the submit click (the run throws only then): nothing was sent.
      return json(502, { error: `Not submitted: ${m?.slice(0, 300)}` });
    }
  });
}
