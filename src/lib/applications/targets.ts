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
  /** Synthetic job requirements shown before preparing the application. */
  requirements?: string[];
  /** File name under /test-forms, served only by the worker's local form host. */
  file: string;
  kind: "test-form";
}

export const APPLICATION_TARGETS: readonly ApplicationTarget[] = [
  { key: "full-application", file: "full-application.html", title: "Senior Software Engineer", company: "Example Corp (synthetic)", kind: "test-form", description: "Realistic single-page application: contact, links, resume, work rights, salary, EEO, essay, consent.", requirements: ["5+ years building production web applications", "TypeScript, React and Node.js", "Experience with automated testing (Playwright or similar)", "Right to work in Australia"] },
  { key: "multi-step", file: "multi-step.html", title: "Platform Engineer", company: "Example Labs (synthetic)", kind: "test-form", description: "Three-step form with custom dropdowns, conditional questions and validation errors.", requirements: ["Infrastructure as code and CI/CD", "Go or TypeScript", "On-call experience"] },
  { key: "greenhouse-like", file: "greenhouse-like.html", title: "Senior Engineer (Greenhouse-style form)", company: "Example Corp (synthetic)", kind: "test-form", description: "Greenhouse-style layout: searchable yes/no dropdowns, hidden resume input behind Attach, EEO section." },
  { key: "lever-like", file: "lever-like.html", title: "Platform Engineer (Lever-style form)", company: "Example Corp (synthetic)", kind: "test-form", description: "Lever-style layout: single full-name field, URL fields, question cards." },
  { key: "ashby-like", file: "ashby-like.html", title: "Data Engineer (Ashby-style form)", company: "Example Corp (synthetic)", kind: "test-form", description: "Ashby-style layout: yes/no toggle buttons, hidden resume upload." },
  { key: "iframe", file: "iframe.html", title: "Software Engineer (embedded form)", company: "Example Corp (synthetic)", kind: "test-form", description: "Application form embedded in a same-origin iframe, plus a blocked third-party frame." },
  { key: "basic", file: "basic.html", title: "Software Engineer", company: "Example Corp (synthetic)", kind: "test-form", description: "Well-labelled fields with autocomplete hints." },
  { key: "ambiguous", file: "ambiguous.html", title: "Software Engineer", company: "Example Corp (synthetic)", kind: "test-form", description: "Weak labels, similar options, sensitive and AI-directed questions." },
  { key: "dynamic", file: "dynamic.html", title: "Software Engineer", company: "Example Corp (synthetic)", kind: "test-form", description: "Delayed and conditional fields." },
  { key: "trap", file: "trap.html", title: "Submit-trap check", company: "Hostile page (synthetic)", kind: "test-form", description: "Tries to auto-submit three ways; all must be blocked." },
];

export function findTarget(key: unknown): ApplicationTarget | null {
  return typeof key === "string" ? (APPLICATION_TARGETS.find((t) => t.key === key) ?? null) : null;
}

/** Hosts we may support once a vetted ATS allowlist + SSRF controls exist. Not enabled. */
export const FUTURE_ATS_HOSTS = ["boards.greenhouse.io", "job-boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com"];

export type JobUrlCheck = { ok: false; reason: string } | { ok: true; host: string; supported: false; note: string };

/** Validates a pasted job URL. Real job sites are never fetched or filled yet. */
export function checkJobUrl(raw: string): JobUrlCheck {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "Enter a full URL starting with https://." };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "Only https:// job links are accepted." };
  const known = FUTURE_ATS_HOSTS.includes(u.hostname);
  return {
    ok: true,
    host: u.hostname,
    supported: false,
    note: known
      ? `${u.hostname} is on our planned list, but filling real job sites is not enabled yet. Use a test job for now.`
      : `${u.hostname} is not a supported application site. Filling real job sites is not enabled yet; use a test job for now.`,
  };
}
