/**
 * Shared request handling for the real-application routes: gate, same
 * origin, page token, size caps, resume validation, profile validation.
 * Nothing is stored; the resume exists only in this request's memory.
 */
import { NextResponse } from "next/server";

import { candidateProfileSchema, type CandidateProfile } from "~/lib/profile/schema";
import { validateResumeBytes, type ResumeKind } from "~/lib/resume/validate";
import { sameOrigin } from "~/server/api/next";
import { verifyDemoToken } from "~/server/apply-demo/demo-token";
import { applyDemoEnabled } from "~/server/apply-demo/gate";

export const MAX_RESUME = 4 * 1024 * 1024; // Vercel request bodies are capped at 4.5 MB.

export const json = (status: number, body: unknown) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export type Parsed = {
  form: FormData;
  str: (k: string) => string;
  resume: () => Promise<{ bytes: Uint8Array; kind: ResumeKind; filename: string } | string>;
  profile: () => CandidateProfile | string;
};

export async function readRequest(request: Request): Promise<Parsed | Response> {
  if (!applyDemoEnabled()) return json(404, { error: "Not found." });
  if (!sameOrigin(request)) return json(403, { error: "Cross-origin request refused." });
  const len = Number(request.headers.get("content-length") ?? "0");
  if (!len || len > MAX_RESUME + 256 * 1024) return json(413, { error: "Request too large (resume must be under 4 MB)." });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: "Expected a form submission." });
  }
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : "";
  };
  if (!verifyDemoToken(str("token"), process.env.APPLY_DEMO_SECRET!)) return json(401, { error: "Session expired. Reload the page." });
  return {
    form,
    str,
    resume: async () => {
      const f = form.get("resume");
      if (!(f instanceof File) || f.size === 0) return "Attach your resume (PDF or DOCX).";
      if (f.size > MAX_RESUME) return "Resume must be under 4 MB.";
      const bytes = new Uint8Array(await f.arrayBuffer());
      const check = validateResumeBytes(f.name, bytes);
      if (!check.ok) return `Resume rejected (${check.error}). Upload a PDF or DOCX.`;
      return { bytes, kind: check.kind, filename: f.name.replace(/[^\w.\- ]/g, "_").slice(0, 80) };
    },
    profile: () => {
      try {
        const p = candidateProfileSchema.safeParse(JSON.parse(str("profile")));
        return p.success ? p.data : `Check your details: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}`;
      } catch {
        return "Invalid profile.";
      }
    },
  };
}

const g = globalThis as unknown as { __afRealBusy?: boolean };
/** One browser run per function instance at a time. */
export async function exclusive<T>(fn: () => Promise<T>): Promise<T | Response> {
  if (g.__afRealBusy) return json(429, { error: "A run is already in progress. Try again in a moment." });
  g.__afRealBusy = true;
  try {
    return await fn();
  } finally {
    g.__afRealBusy = false;
  }
}
