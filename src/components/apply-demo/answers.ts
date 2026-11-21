/**
 * Pure helpers for the real-application review UI: which questions the person
 * can answer, what control each gets (built from the form's REAL options), and
 * how answers are keyed for the engine. Kept free of React so it can be tested.
 */

export interface ReportField {
  id: string;
  label: string;
  control: string;
  kind: string;
  required: boolean;
  tier: string;
  outcome: string;
  value?: string | boolean;
  reason?: string;
  step: number;
  options?: string[];
  optionsPartial?: boolean;
  answer?: string;
  suggestions?: string[];
  suggestedBy?: "rules" | "ai";
  confidence?: number;
  note?: string;
}

/** Must match normQ in ~/lib/apply/decision/rules (saved answers are keyed by normalised question text). */
export const normQ = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export type AnswerControl = "select" | "search" | "checkbox" | "textarea" | "text";

export function answerControl(f: ReportField): AnswerControl {
  if (f.control === "checkbox") return "checkbox";
  if (f.control === "select" || f.control === "radio" || f.control === "combobox") {
    if (f.options?.length && !f.optionsPartial) return "select";
    return "search"; // long or async list: type to search the form's own list
  }
  return f.control === "textarea" ? "textarea" : "text";
}

/**
 * Questions the person can answer: never file uploads (resume / cover letter are not text answers),
 * and only questions that still need an answer or that the person already answered (so answers stay
 * visible and editable between review attempts).
 */
export function answerableFields(fields: ReportField[], answers: Record<string, string>): ReportField[] {
  const seen = new Set<string>();
  return fields.filter((f) => {
    if (!f.label || f.control === "file" || seen.has(f.label)) return false;
    const answered = (answers[f.label] ?? "").trim() !== "";
    if (f.outcome === "verified" && !answered) return false;
    if (f.outcome === "skipped" && !answered && !f.required) return false;
    seen.add(f.label);
    return true;
  });
}

export function savedAnswersFrom(answers: Record<string, string>): Record<string, string> {
  const saved: Record<string, string> = {};
  for (const [label, v] of Object.entries(answers)) if (v.trim()) saved[normQ(label)] = v.trim();
  return saved;
}

export type StatusView = { label: string; tone: "ok" | "warn" | "bad" | "idle" };

export function statusOf(f: ReportField): StatusView {
  switch (f.outcome) {
    case "verified":
      return { label: "Verified in the form", tone: "ok" };
    case "needs_human":
      return f.suggestions?.length ? { label: "Confirm a suggestion", tone: "warn" } : { label: "Needs your answer", tone: "warn" };
    case "mismatch":
      return { label: "Filled, but the form shows something else", tone: "bad" };
    case "error":
      return { label: "Could not fill", tone: "bad" };
    case "skipped":
      return { label: "Skipped", tone: "idle" };
    default:
      return { label: f.outcome, tone: "idle" };
  }
}

export function confidenceLabel(f: ReportField): string | null {
  if (f.outcome !== "verified" || f.confidence === undefined) return null;
  if (f.answer !== undefined || f.note?.startsWith("Your")) return "from your answer";
  return f.confidence >= 1 ? "exact" : `${Math.round(f.confidence * 100)}% confidence`;
}
