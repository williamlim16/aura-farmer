import { NextResponse } from "next/server";
import { z } from "zod";

import { savedAnswersFrom } from "~/components/apply-real/answers";
import { applyWithAiEnabled } from "~/lib/apply/flag";
import { createClient } from "~/lib/supabase/server";
import { exclusive, sameOrigin } from "~/server/apply-real/guard";
import { resolveApplication, ResolveError } from "~/server/apply-real/resolve";
import { reviewApplication } from "~/server/apply-real/run-real";
import { getApplyJob, getApplyProfile, getApplyResume } from "~/server/apply-real/team-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const json = (status: number, body: unknown) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

const CONTACT_KEYS = ["fullName", "firstName", "lastName", "email", "phone", "location", "linkedin", "github", "website"] as const;
const bodySchema = z.object({
  /** The team's integer job.id. Omit for the "paste a job URL" flow. */
  jobId: z.number().int().positive().optional(),
  postingUrl: z.string().trim().max(2000).optional(),
  /** The user's corrections on the review screen. */
  contact: z.record(z.enum(CONTACT_KEYS), z.string().max(300)).optional(),
  answers: z.record(z.string().max(300), z.string().max(4000)).optional(),
});

/**
 * POST /api/apply/review: fill a real Greenhouse/Lever application in cloud
 * Chromium for the signed-in user, using their existing profile and resume
 * (or the job's tailored resume). Read-back verification, missing questions
 * and a screenshot are returned. This route CANNOT submit anything.
 */
export async function POST(request: Request) {
  if (!applyWithAiEnabled()) return json(404, { error: "Not found." });
  if (!sameOrigin(request)) return json(403, { error: "Cross-origin request refused." });

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = !error && typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  if (!userId) return json(401, { error: "Please sign in again." });
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;

  const len = Number(request.headers.get("content-length") ?? "0");
  if (len > 64 * 1024) return json(413, { error: "Request too large." });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: "Invalid request." });
  const { jobId, contact, answers } = parsed.data;

  // The job must belong to the signed-in user; anyone else's id looks like a missing one.
  const job = jobId === undefined ? null : await getApplyJob(userId, jobId);
  if (jobId !== undefined && !job) return json(404, { error: "Job not found." });
  const pasted = parsed.data.postingUrl?.trim() ?? "";
  const postingUrl = pasted.length > 0 ? pasted : (job?.url ?? "");
  if (!postingUrl) return json(400, { error: "Enter the job posting URL." });

  let app;
  try {
    app = await resolveApplication(postingUrl);
  } catch (e) {
    return json(400, { error: e instanceof ResolveError ? e.message : "Could not open that job posting." });
  }

  const resume = await getApplyResume(userId, job?.id ?? null);
  if ("error" in resume) return json(400, { error: resume.error });

  const profile = await getApplyProfile(userId, email);
  const c: Record<string, { value: string; source: "parsed" | "llm" | "user"; confidence: number } | undefined> = { ...profile.contact };
  for (const [k, v] of Object.entries(contact ?? {})) {
    const value = v.trim();
    if (!value) delete c[k];
    else if (c[k]?.value !== value) c[k] = { value, source: "user", confidence: 1 };
  }
  profile.contact = c;
  profile.preferences = { ...profile.preferences, savedAnswers: savedAnswersFrom(answers ?? {}) };

  const out = await exclusive(userId, async () => {
    try {
      const ev = await reviewApplication({ app, profile, resume: { bytes: resume.bytes, kind: resume.kind, filename: resume.filename } });
      return json(200, { app, resume: { source: resume.source, filename: resume.filename }, ...ev });
    } catch (e) {
      const m = e instanceof Error ? e.message.split("\n")[0] : String(e);
      console.error("[apply-with-ai review]", m);
      return json(502, { error: `Could not fill the application page: ${m?.slice(0, 300)}` });
    }
  });
  if (out === "busy") return json(429, { error: "A run is already in progress. Try again in a moment." });
  if (out === "too_soon") return json(429, { error: "Please wait a few seconds between runs." });
  return out;
}
