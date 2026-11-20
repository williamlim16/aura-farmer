/**
 * Allow-listed application targets. Only these can be selected, and the
 * browser worker can only reach the origin that serves them. Real job sites
 * are intentionally absent until a vetted ATS allowlist + SSRF controls exist.
 * Pure data, safe to import from client components.
 */
export interface ApplicationTarget {
  key: string;
  title: string;
  company: string;
  description: string;
  /** File name under /test-forms, served only by the worker's local form host. */
  file: string;
  kind: "test-form";
}

export const APPLICATION_TARGETS: readonly ApplicationTarget[] = [
  { key: "full-application", file: "full-application.html", title: "Senior Software Engineer", company: "Example Corp (synthetic)", kind: "test-form", description: "Realistic single-page application: contact, links, resume, work rights, salary, EEO, essay, consent." },
  { key: "multi-step", file: "multi-step.html", title: "Platform Engineer", company: "Example Labs (synthetic)", kind: "test-form", description: "Three-step form with custom dropdowns, conditional questions and validation errors." },
  { key: "basic", file: "basic.html", title: "Software Engineer", company: "Example Corp (synthetic)", kind: "test-form", description: "Well-labelled fields with autocomplete hints." },
  { key: "ambiguous", file: "ambiguous.html", title: "Software Engineer", company: "Example Corp (synthetic)", kind: "test-form", description: "Weak labels, similar options, sensitive and AI-directed questions." },
  { key: "dynamic", file: "dynamic.html", title: "Software Engineer", company: "Example Corp (synthetic)", kind: "test-form", description: "Delayed and conditional fields." },
  { key: "trap", file: "trap.html", title: "Submit-trap check", company: "Hostile page (synthetic)", kind: "test-form", description: "Tries to auto-submit three ways; all must be blocked." },
];

export function findTarget(key: unknown): ApplicationTarget | null {
  return typeof key === "string" ? (APPLICATION_TARGETS.find((t) => t.key === key) ?? null) : null;
}
