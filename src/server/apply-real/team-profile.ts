/**
 * Team profile rows (user_profile, experience, education) + the sign-in email
 * -> the Apply Engine's CandidateProfile. Pure: no database or network access.
 *
 * Everything here was entered or confirmed by the user on the Profile page, so
 * values are marked source "user" (confidence 1). Application preferences
 * (work rights, sponsorship, EEO...) are NOT stored by the team and are never
 * guessed: the user supplies them on the review screen.
 */
import { candidateProfileSchema, type CandidateProfile } from "~/lib/profile/schema";

export interface TeamProfileRow {
  fullName: string | null;
  location: string | null;
  phone: string | null;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  summary: string | null;
  skills: string | null;
}
export interface TeamExperienceRow {
  jobTitle: string;
  company: string;
  startDate: string;
  endDate: string | null;
  isCurrent: boolean;
  description: string | null;
}
export interface TeamEducationRow {
  school: string;
  degree: string;
  fieldOfStudy: string | null;
  startDate: string;
  endDate: string | null;
}

const user = <T>(value: T) => ({ value, source: "user" as const, confidence: 1 });
const clean = (s: string | null | undefined) => (s ?? "").trim();

/** Free-text skills ("Languages: TS, Go\nTools: Docker") -> a flat, de-duplicated list. */
export function splitSkills(text: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of clean(text).split(/\n+/)) {
    const body = line.includes(":") ? line.slice(line.indexOf(":") + 1) : line;
    for (const raw of body.split(/[,;|•·]/)) {
      const s = raw.trim().replace(/^[-*]\s*/, "");
      if (s && s.length <= 60 && !seen.has(s.toLowerCase())) {
        seen.add(s.toLowerCase());
        out.push(s);
      }
    }
  }
  return out.slice(0, 80);
}

function bullets(description: string | null): string[] {
  return clean(description)
    .split(/\n+/)
    .map((l) => l.replace(/^[\s•\-*·]+/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

const url = (s: string | null) => {
  const v = clean(s);
  if (!v) return undefined;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
};

export function teamProfileToCandidate(input: {
  profile: TeamProfileRow | null;
  experiences: TeamExperienceRow[];
  educations: TeamEducationRow[];
  email: string | null;
}): CandidateProfile {
  const p = input.profile;
  const fullName = clean(p?.fullName);
  const [firstName, ...rest] = fullName.split(/\s+/).filter(Boolean);
  const lastName = rest.join(" ");
  const email = clean(input.email);
  const contact: Record<string, ReturnType<typeof user<string>>> = {};
  const set = (k: string, v: string | undefined) => {
    if (v) contact[k] = user(v);
  };
  set("fullName", fullName);
  set("firstName", firstName);
  set("lastName", lastName);
  set("email", /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : undefined);
  set("phone", clean(p?.phone));
  set("location", clean(p?.location));
  set("linkedin", url(p?.linkedinUrl ?? null));
  set("github", url(p?.githubUrl ?? null));
  set("website", url(p?.websiteUrl ?? null));

  return candidateProfileSchema.parse({
    schemaVersion: 1,
    contact,
    summary: clean(p?.summary) || undefined,
    experience: input.experiences.map((e) => ({
      title: e.jobTitle,
      company: e.company,
      start: clean(e.startDate) || undefined,
      end: e.isCurrent ? "Present" : clean(e.endDate) || undefined,
      bullets: bullets(e.description),
    })),
    education: input.educations.map((e) => ({
      degree: [e.degree, clean(e.fieldOfStudy)].filter(Boolean).join(", "),
      institution: e.school,
      start: clean(e.startDate) || undefined,
      end: clean(e.endDate) || undefined,
    })),
    skills: splitSkills(p?.skills),
    preferences: {},
  });
}
