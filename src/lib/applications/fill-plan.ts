/**
 * Fill plan for the browser-extension handoff: what the user's own browser
 * should fill on the real application page. Built only from fields the
 * worker filled AND read back; safety-blocked fields are never included
 * (their values are listed only as "needs your input").
 */
import type { ReportFieldLike } from "./view";

export interface FillPlanField {
  label: string;
  control: string;
  value: string | boolean;
  /** AI-drafted text the user should edit. */
  reviewRequired: boolean;
}

export interface FillPlan {
  version: 1;
  applicationId: string;
  title: string | null;
  company: string | null;
  createdAt: string;
  expiresAt: string;
  fields: FillPlanField[];
  needsInput: { label: string; reason: string }[];
  resume: { filename: string; base64: string } | null;
}

export function buildFillPlan(app: { id: string; title: string | null; company: string | null; report: { fields: (ReportFieldLike & { control: string })[] } | null }, resume: { filename: string; bytes: Uint8Array } | null, now = new Date(), ttlMs = 30 * 60_000): FillPlan {
  const fields: FillPlanField[] = [];
  const needsInput: FillPlan["needsInput"] = [];
  for (const f of app.report?.fields ?? []) {
    if (f.tier === "guard" || f.outcome === "needs_human" || f.outcome === "error" || f.outcome === "mismatch") {
      if (f.label) needsInput.push({ label: f.label, reason: f.reason ?? "Needs your input." });
      continue;
    }
    if (f.outcome !== "verified" || f.control === "file" || f.value === undefined || !f.label) continue;
    fields.push({ label: f.label, control: f.control, value: f.value, reviewRequired: !!f.reviewRequired });
  }
  return {
    version: 1,
    applicationId: app.id,
    title: app.title,
    company: app.company,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    fields,
    needsInput,
    resume: resume ? { filename: resume.filename, base64: Buffer.from(resume.bytes).toString("base64") } : null,
  };
}
