/** A form control as extracted from the page. Serialisable (crosses page.evaluate). */
export interface FormField {
  /** Stable id we stamp on the element as data-af-id. */
  id: string;
  control: "text" | "email" | "tel" | "url" | "number" | "date" | "textarea" | "select" | "radio" | "checkbox" | "file" | "combobox";
  /** Best human-readable label, and how it was found (lower tiers = less certain). */
  label: string;
  labelSource: "label-for" | "label-wrap" | "aria-labelledby" | "aria-label" | "legend" | "placeholder" | "nearby-text" | "name" | "none";
  name: string;
  htmlId: string;
  placeholder: string;
  autocomplete: string;
  required: boolean;
  /** Option labels for select / radio group / checkbox group. */
  options: string[];
  multiple: boolean;
  accept: string;
}

export type FieldKind =
  | "first_name"
  | "last_name"
  | "full_name"
  | "email"
  | "phone"
  | "location"
  | "country"
  | "education_level"
  | "linkedin"
  | "github"
  | "website"
  | "resume"
  | "cover_letter"
  | "current_title"
  | "current_company"
  | "years_experience"
  | "work_authorization"
  | "sponsorship"
  | "salary"
  | "salary_history"
  | "start_date"
  | "notice_period"
  | "relocation"
  | "referral_source"
  | "eeo"
  | "legal"
  | "consent"
  | "ai_directed"
  /** About someone else (referrer, reference, emergency contact): never filled from the candidate profile. */
  | "third_party"
  | "essay"
  | "unknown";

/** Kinds no provider may ever fill, regardless of tier. */
export const ALWAYS_HUMAN_KINDS: ReadonlySet<FieldKind> = new Set(["eeo", "legal", "salary_history", "consent", "ai_directed", "third_party"]);

export interface Classification {
  kind: FieldKind;
  confidence: number;
  /** Which signal decided the kind, for debugging and benchmarks. */
  signal: "autocomplete" | "input-type" | "label" | "name-attr" | "none";
}

export type DecisionTier = "rule" | "jev" | "llm";

export type Decision =
  | { action: "fill"; value: string | boolean; tier: DecisionTier; confidence: number; reviewRequired?: boolean; note?: string }
  | { action: "upload"; file: "resume"; tier: DecisionTier; confidence: number }
  | { action: "skip"; reason: string; tier: DecisionTier | "guard" }
  | { action: "human"; reason: string; tier: DecisionTier | "guard" };

export type FieldOutcome =
  | "verified" // filled and read back equal
  | "mismatch" // filled but read-back differs
  | "error" // fill threw
  | "needs_human"
  | "skipped";
