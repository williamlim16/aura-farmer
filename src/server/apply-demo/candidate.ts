/**
 * Candidate input for the Apply Demo: typed (fictional) fields, optionally
 * merged over a profile parsed from an uploaded resume. Typed values win.
 * Kept in memory for the request only.
 */
import { z } from "zod";

import { parseResumeText } from "~/lib/resume/parse-profile";
import { candidateProfileSchema, emptyProfile, type CandidateProfile } from "~/lib/profile/schema";
import { validateResumeBytes, type ResumeKind } from "~/lib/resume/validate";
import { extractResumeText } from "~/server/resume/extract-text";

const emptyToUndefined = (v: string | undefined) => (v === "" ? undefined : v);
const opt = (max: number) => z.string().trim().max(max).optional().transform(emptyToUndefined);
const optUrl = z.string().trim().max(300).optional().transform(emptyToUndefined).pipe(z.string().url().optional());

export const candidateInputSchema = z.object({
  fullName: opt(120),
  email: z.string().trim().max(200).optional().transform(emptyToUndefined).pipe(z.string().email().optional()),
  phone: opt(40),
  location: opt(120),
  linkedin: optUrl,
  github: optUrl,
  website: optUrl,
  summary: opt(2000),
  currentTitle: opt(120),
  currentCompany: opt(120),
  skills: opt(1000),
  workAuthCountry: opt(60),
  authorised: z.boolean().optional(),
  needsSponsorship: z.boolean().optional(),
  salaryExpectation: opt(80),
  noticePeriod: opt(80),
});
export type CandidateInput = z.infer<typeof candidateInputSchema>;

const user = <T>(value: T) => ({ value, source: "user" as const, confidence: 1 });

export async function buildDemoProfile(
  input: CandidateInput,
  resumeFile: File | null,
): Promise<{ profile: CandidateProfile; resume: { bytes: Uint8Array; kind: ResumeKind; filename: string } | null; notes: string[] }> {
  const notes: string[] = [];
  let profile = emptyProfile();
  let resume: { bytes: Uint8Array; kind: ResumeKind; filename: string } | null = null;

  if (resumeFile && resumeFile.size > 0) {
    const bytes = new Uint8Array(await resumeFile.arrayBuffer());
    const check = validateResumeBytes(resumeFile.name, bytes);
    if (!check.ok) throw new CandidateError(`Resume rejected (${check.error}). Upload a PDF or DOCX under 5 MB.`);
    resume = { bytes, kind: check.kind, filename: resumeFile.name };
    try {
      const parsed = parseResumeText(await extractResumeText(bytes, check.kind));
      profile = parsed.profile;
      notes.push(`Resume parsed: ${profile.experience.length} experience, ${profile.education.length} education, ${profile.skills.length} skills.`);
    } catch (e) {
      notes.push(`Resume attached but could not be parsed (${e instanceof Error ? e.message : "unknown"}); using typed details only.`);
    }
  }

  const c = profile.contact;
  if (input.fullName) {
    c.fullName = user(input.fullName);
    const parts = input.fullName.split(/\s+/);
    c.firstName = user(parts[0]!);
    if (parts.length > 1) c.lastName = user(parts.slice(1).join(" "));
  }
  if (input.email) c.email = user(input.email);
  if (input.phone) c.phone = user(input.phone);
  if (input.location) c.location = user(input.location);
  if (input.linkedin) c.linkedin = user(input.linkedin);
  if (input.github) c.github = user(input.github);
  if (input.website) c.website = user(input.website);
  if (input.summary) profile.summary = input.summary;
  if (input.currentTitle && input.currentCompany && !profile.experience.length) {
    profile.experience.push({ title: input.currentTitle, company: input.currentCompany, bullets: [] });
  }
  if (input.skills) profile.skills = [...new Set([...profile.skills, ...input.skills.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)])];
  const prefs = { ...(profile.preferences ?? {}) };
  if (input.workAuthCountry && input.authorised !== undefined) prefs.workAuthorization = { ...(prefs.workAuthorization ?? {}), [input.workAuthCountry]: input.authorised };
  if (input.needsSponsorship !== undefined) prefs.needsSponsorship = input.needsSponsorship;
  if (input.salaryExpectation) prefs.salaryExpectation = input.salaryExpectation;
  if (input.noticePeriod) prefs.noticePeriod = input.noticePeriod;
  profile.preferences = prefs;

  const parsed = candidateProfileSchema.safeParse(profile);
  if (!parsed.success) throw new CandidateError(`Candidate details are invalid: ${parsed.error.issues[0]?.message ?? "check the fields"}.`);
  if (!parsed.data.contact.email && !parsed.data.contact.fullName) throw new CandidateError("Enter at least a name and email, or upload a resume.");
  return { profile: parsed.data, resume, notes };
}

export class CandidateError extends Error {}
