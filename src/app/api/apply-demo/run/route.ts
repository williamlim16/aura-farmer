import { NextResponse } from "next/server";

import { sameOrigin } from "~/server/api/next";
import { verifyDemoToken } from "~/server/apply-demo/demo-token";
import { applyDemoEnabled } from "~/server/apply-demo/gate";
import { demoPersona } from "~/server/apply-demo/personas";
import { DemoInputError, runDemo } from "~/server/apply-demo/run-demo";
import { renderResumePdf } from "~/server/resume/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One browser run per request: launch Chromium, load the form, fill, verify, screenshot.
export const maxDuration = 120;

const g = globalThis as unknown as { __afDemoBusy?: boolean };
const json = (status: number, body: unknown) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * Runs the autofill engine on an allow-listed synthetic form for a fictional
 * persona. Accepts only keys (form, persona) and the page-issued token: no
 * URLs, no free-text candidate data, no files.
 */
export async function POST(request: Request) {
  if (!applyDemoEnabled()) return json(404, { error: "Not found." });
  if (!sameOrigin(request)) return json(403, { error: "Cross-origin request refused." });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json(415, { error: "Expected JSON." });
  const raw = await request.text();
  if (raw.length > 2000) return json(413, { error: "Request too large." });
  let body: { token?: unknown; formKey?: unknown; persona?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return json(400, { error: "Invalid JSON." });
  }
  if (!verifyDemoToken(body.token, process.env.APPLY_DEMO_SECRET!)) return json(401, { error: "Demo session expired. Reload the page." });
  const persona = demoPersona(body.persona);
  if (!persona) return json(400, { error: "Choose one of the fictional candidates." });
  if (typeof body.formKey !== "string") return json(400, { error: "Choose a test form." });
  if (g.__afDemoBusy) return json(429, { error: "A run is already in progress on this instance. Try again in a moment." });

  g.__afDemoBusy = true;
  try {
    const resumeBytes = await renderResumePdf(persona.profile);
    const result = await runDemo({
      formKey: body.formKey,
      profile: persona.profile,
      resume: { bytes: resumeBytes, kind: "pdf", filename: `${persona.key}-resume.pdf` },
      timeoutMs: 90_000,
    });
    result.events.unshift(`Candidate: ${persona.label}; resume: generated fictional PDF (${resumeBytes.byteLength} bytes).`);
    return json(200, result);
  } catch (e) {
    if (e instanceof DemoInputError) return json(400, { error: e.message });
    const message = e instanceof Error ? e.message : String(e);
    console.error("[apply-demo]", message);
    return json(500, { error: `Run failed: ${message.split("\n")[0]?.slice(0, 300)}` });
  } finally {
    g.__afDemoBusy = false;
  }
}
