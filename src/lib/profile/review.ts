/**
 * Profile review: a flat, editable view of CandidateProfile for the review UI,
 * and the merge back. Edited values become source "user" with confidence 1,
 * so the decision layer can tell user-confirmed facts from parser guesses.
 * Pure; shared by the demo and (later) the hosted app.
 */
import { candidateProfileSchema, type CandidateProfile } from "./schema";

export const CONTACT_FIELDS = [
  "fullName",
  "firstName",
  "lastName",
  "email",
  "phone",
  "location",
  "linkedin",
  "github",
  "website",
] as const;
type ContactKey = (typeof CONTACT_FIELDS)[number];

export interface ReviewContactField {
  value: string;
  source: "parsed" | "llm" | "user" | "missing";
  confidence: number;
}

export interface ProfileReview {
  contact: Record<ContactKey, ReviewContactField>;
  summary: string;
  totalYearsExperience: string;
  skills: string; // comma-separated
  experience: { title: string; company: string; start: string; end: string }[];
  education: { degree: string; institution: string; start: string; end: string }[];
  preferences: {
    /** e.g. "Australia" */
    workAuthCountry: string;
    workAuthorized: "" | "yes" | "no";
    needsSponsorship: "" | "yes" | "no";
    salaryExpectation: string;
    noticePeriod: string;
    earliestStartDate: string;
    willingToRelocate: "" | "yes" | "no";
    referralSource: string;
  };
}

const yn = (b: boolean | undefined): "" | "yes" | "no" => (b === undefined ? "" : b ? "yes" : "no");
const fromYn = (s: string): boolean | undefined => (s === "yes" ? true : s === "no" ? false : undefined);

export function toReview(p: CandidateProfile): ProfileReview {
  const contact = Object.fromEntries(
    CONTACT_FIELDS.map((k) => {
      const v = p.contact[k];
      return [k, v ? { value: v.value, source: v.source, confidence: v.confidence } : { value: "", source: "missing", confidence: 0 }];
    }),
  ) as Record<ContactKey, ReviewContactField>;
  const [authCountry, authValue] = Object.entries(p.preferences.workAuthorization ?? {})[0] ?? ["", undefined];
  return {
    contact,
    summary: p.summary ?? "",
    totalYearsExperience: p.totalYearsExperience ? String(p.totalYearsExperience.value) : "",
    skills: p.skills.join(", "),
    experience: p.experience.map((e) => ({ title: e.title, company: e.company, start: e.start ?? "", end: e.end ?? "" })),
    education: p.education.map((e) => ({ degree: e.degree, institution: e.institution, start: e.start ?? "", end: e.end ?? "" })),
    preferences: {
      workAuthCountry: authCountry,
      workAuthorized: yn(authValue),
      needsSponsorship: yn(p.preferences.needsSponsorship),
      salaryExpectation: p.preferences.salaryExpectation ?? "",
      noticePeriod: p.preferences.noticePeriod ?? "",
      earliestStartDate: p.preferences.earliestStartDate ?? "",
      willingToRelocate: yn(p.preferences.willingToRelocate),
      referralSource: p.preferences.referralSource ?? "",
    },
  };
}

export type ReviewInput = {
  contact?: Partial<Record<ContactKey, string>>;
  summary?: string;
  totalYearsExperience?: string;
  skills?: string;
  experience?: ProfileReview["experience"];
  education?: ProfileReview["education"];
  preferences?: Partial<ProfileReview["preferences"]>;
};

const s = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const URL_FIELDS: ContactKey[] = ["linkedin", "github", "website"];

export type ApplyReviewResult =
  | { ok: true; profile: CandidateProfile }
  | { ok: false; errors: Record<string, string> };

/** Merge reviewed values into the profile. Unchanged values keep their provenance. */
export function applyReview(base: CandidateProfile, input: ReviewInput): ApplyReviewResult {
  const next: CandidateProfile = structuredClone(base);
  const errors: Record<string, string> = {};

  for (const k of CONTACT_FIELDS) {
    if (input.contact?.[k] === undefined) continue;
    let value = s(input.contact[k], 300);
    if (value && URL_FIELDS.includes(k) && !/^https?:\/\//i.test(value)) value = `https://${value}`;
    const current = next.contact[k]?.value ?? "";
    if (value === current) continue;
    if (!value) delete next.contact[k];
    else next.contact[k] = { value, source: "user", confidence: 1 };
  }

  if (input.summary !== undefined) next.summary = s(input.summary, 4000) || undefined;
  if (input.skills !== undefined) {
    next.skills = [...new Set(s(input.skills, 4000).split(",").map((x) => x.trim()).filter((x) => x && x.length <= 60))].slice(0, 100);
  }
  if (input.totalYearsExperience !== undefined) {
    const raw = s(input.totalYearsExperience, 10);
    const n = Number(raw);
    if (!raw) delete next.totalYearsExperience;
    else if (!Number.isFinite(n) || n < 0 || n > 70) errors.totalYearsExperience = "Enter a number of years between 0 and 70.";
    else if (n !== next.totalYearsExperience?.value) next.totalYearsExperience = { value: n, source: "user", confidence: 1 };
  }
  if (input.experience) {
    next.experience = input.experience.slice(0, 20).filter((e) => s(e.title) || s(e.company)).map((e, i) => ({
      title: s(e.title, 200),
      company: s(e.company, 200),
      start: s(e.start, 40) || undefined,
      end: s(e.end, 40) || undefined,
      bullets: base.experience[i]?.title === s(e.title, 200) ? (base.experience[i]?.bullets ?? []) : [],
    }));
  }
  if (input.education) {
    next.education = input.education.slice(0, 10).filter((e) => s(e.degree) || s(e.institution)).map((e) => ({
      degree: s(e.degree, 200),
      institution: s(e.institution, 200),
      start: s(e.start, 40) || undefined,
      end: s(e.end, 40) || undefined,
    }));
  }
  if (input.preferences) {
    const p = input.preferences;
    const prefs = next.preferences;
    if (p.workAuthCountry !== undefined || p.workAuthorized !== undefined) {
      const country = s(p.workAuthCountry ?? Object.keys(prefs.workAuthorization ?? {})[0] ?? "", 60);
      const val = fromYn(p.workAuthorized ?? yn(Object.values(prefs.workAuthorization ?? {})[0]));
      if (country && val !== undefined) prefs.workAuthorization = { [country]: val };
      else if (!country && val !== undefined) errors.workAuthCountry = "Name the country this answer applies to.";
      else delete prefs.workAuthorization;
    }
    if (p.needsSponsorship !== undefined) prefs.needsSponsorship = fromYn(p.needsSponsorship);
    if (p.willingToRelocate !== undefined) prefs.willingToRelocate = fromYn(p.willingToRelocate);
    for (const k of ["salaryExpectation", "noticePeriod", "earliestStartDate", "referralSource"] as const) {
      if (p[k] !== undefined) prefs[k] = s(p[k], 200) || undefined;
    }
  }

  // Re-derive first/last from an edited full name only when those were not edited directly.
  const full = next.contact.fullName;
  if (full?.source === "user" && input.contact?.firstName === undefined && input.contact?.lastName === undefined) {
    const parts = full.value.split(/\s+/);
    if (parts.length >= 2) {
      next.contact.firstName = { value: parts[0]!, source: "user", confidence: 1 };
      next.contact.lastName = { value: parts.slice(1).join(" "), source: "user", confidence: 1 };
    }
  }

  const parsed = candidateProfileSchema.safeParse(next);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path.filter((x) => typeof x === "string" && x !== "value" && x !== "contact").join(".") || "profile";
      errors[key] ??= key === "email" ? "Enter a valid email address." : URL_FIELDS.includes(key as ContactKey) ? "Enter a valid URL." : issue.message;
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, profile: parsed.data! };
}
