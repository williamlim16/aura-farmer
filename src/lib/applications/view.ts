/**
 * Presentation logic for application review, shared by server and client
 * components. Pure and unit-tested so the React layer stays thin.
 */
import type { ApplicationStatus } from "./status";

export interface ReportFieldLike {
  id: string;
  label: string;
  kind: string;
  required: boolean;
  tier: "rule" | "jev" | "llm" | "guard";
  outcome: "verified" | "mismatch" | "error" | "needs_human" | "skipped";
  value?: string | boolean;
  reason?: string;
  reviewRequired?: boolean;
  round: number;
}

export type FieldGroup = "filled" | "review" | "blocked" | "problem" | "skipped";

export const GROUP_LABEL: Record<FieldGroup, string> = {
  filled: "Filled automatically",
  review: "Needs your input",
  blocked: "Blocked for safety",
  problem: "Errors or mismatches",
  skipped: "Skipped",
};

export const TIER_LABEL: Record<ReportFieldLike["tier"], string> = { rule: "Rules", jev: "Jev", llm: "LLM", guard: "Safety guard" };

/** Which review bucket a field belongs to. LLM drafts flagged for review count as "review". */
export function fieldGroup(f: ReportFieldLike): FieldGroup {
  if (f.outcome === "error" || f.outcome === "mismatch") return "problem";
  if (f.outcome === "skipped") return "skipped";
  if (f.outcome === "needs_human") return f.tier === "guard" ? "blocked" : "review";
  return f.reviewRequired ? "review" : "filled";
}

export function groupFields<F extends ReportFieldLike>(fields: F[]): Record<FieldGroup, F[]> {
  const out: Record<FieldGroup, F[]> = { filled: [], review: [], blocked: [], problem: [], skipped: [] };
  for (const f of fields) out[fieldGroup(f)].push(f);
  return out;
}

export function displayValue(f: ReportFieldLike): string {
  if (f.outcome === "verified" || f.outcome === "mismatch") {
    if (typeof f.value === "boolean") return f.value ? "Checked" : "Unchecked";
    if (f.value === undefined) return f.kind === "resume" ? "Resume attached" : "Filled";
    return String(f.value);
  }
  return f.reason ?? "";
}

/**
 * The four stages users care about. "Submitted" is only reached when the user
 * confirms they submitted the form themselves; the system never submits.
 */
export const STAGES = ["Prepared", "Filled", "Reviewed", "Submitted"] as const;
export type Stage = (typeof STAGES)[number];

export interface StatusView {
  label: string;
  tone: "neutral" | "progress" | "success" | "warning" | "danger";
  stageIndex: number; // index into STAGES that is complete
  active: boolean; // worker is queued/running
  description: string;
}

export function statusView(status: ApplicationStatus): StatusView {
  switch (status) {
    case "draft":
      return { label: "Prepared", tone: "neutral", stageIndex: 0, active: false, description: "Ready to fill. Start the autofill run when you are ready." };
    case "queued":
      return { label: "Queued", tone: "progress", stageIndex: 0, active: true, description: "Waiting for the browser worker." };
    case "running":
      return { label: "Filling", tone: "progress", stageIndex: 0, active: true, description: "The browser worker is filling the form. Nothing will be submitted." };
    case "ready_for_review":
      return { label: "Filled, awaiting your review", tone: "warning", stageIndex: 1, active: false, description: "Check every field below, complete anything flagged, then submit the form yourself." };
    case "submitted_by_user":
      return { label: "Submitted (confirmed by you)", tone: "success", stageIndex: 3, active: false, description: "You confirmed you submitted this application yourself." };
    case "failed":
      return { label: "Failed", tone: "danger", stageIndex: 0, active: false, description: "The autofill run did not finish. You can retry." };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral", stageIndex: 0, active: false, description: "This run was cancelled. You can start it again." };
  }
}
