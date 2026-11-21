import { NextResponse } from "next/server";

import { currentUserId, sameOrigin } from "~/server/api/next";
import { buildDemoProfile, CandidateError, candidateInputSchema } from "~/server/apply-demo/candidate";
import { applyDemoEnabled } from "~/server/apply-demo/gate";
import { DemoInputError, runDemo, type DemoTarget } from "~/server/apply-demo/run-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One browser run per request: launch Chromium, load the form, fill, verify, screenshot.
export const maxDuration = 120;

const g = globalThis as unknown as { __afDemoBusy?: boolean };
const text = (v: FormDataEntryValue | null, fallback = "") => (typeof v === "string" ? v : fallback);
const json = (status: number, body: unknown) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request) {
  if (!applyDemoEnabled()) return json(404, { error: "Not found." });
  if (!sameOrigin(request)) return json(403, { error: "Cross-origin request refused." });
  if (!(await currentUserId())) return json(401, { error: "Please sign in." });
  const len = Number(request.headers.get("content-length") ?? "0");
  if (!len || len > 6 * 1024 * 1024) return json(413, { error: "Request too large (resume must be under 5 MB)." });
  if (g.__afDemoBusy) return json(429, { error: "A run is already in progress on this instance. Try again in a moment." });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: "Expected a form submission." });
  }
  const targetKind = form.get("targetKind");
  const target: DemoTarget | null =
    targetKind === "synthetic" ? { kind: "synthetic", key: text(form.get("formKey")) } : targetKind === "ats" ? { kind: "ats", url: text(form.get("url")) } : null;
  if (!target) return json(400, { error: "Choose a test form or paste an application URL." });

  let candidateRaw: unknown;
  try {
    candidateRaw = JSON.parse(text(form.get("candidate"), "{}"));
  } catch {
    return json(400, { error: "Invalid candidate details." });
  }
  const candidate = candidateInputSchema.safeParse(candidateRaw);
  if (!candidate.success) return json(400, { error: `Check the candidate details: ${candidate.error.issues[0]?.path.join(".")} ${candidate.error.issues[0]?.message}` });
  const file = form.get("resume");

  g.__afDemoBusy = true;
  try {
    const { profile, resume, notes } = await buildDemoProfile(candidate.data, file instanceof File ? file : null);
    const result = await runDemo({ target, profile, resume, timeoutMs: 90_000 });
    result.events.unshift(...notes);
    return json(200, result);
  } catch (e) {
    if (e instanceof CandidateError || e instanceof DemoInputError) return json(400, { error: e.message });
    const message = e instanceof Error ? e.message : String(e);
    console.error("[apply-demo]", message);
    // Operational message only (launch/navigation/timeout), never candidate data.
    return json(500, { error: `Run failed: ${message.split("\n")[0]?.slice(0, 300)}` });
  } finally {
    g.__afDemoBusy = false;
  }
}
