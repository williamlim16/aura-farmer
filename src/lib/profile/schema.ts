import { z } from "zod";

/**
 * Structured candidate profile. Field shapes are informed by Career Ops'
 * config/profile.yml `candidate` block and its evidence-backed career profile,
 * but stored as JSON (one row per user) rather than YAML files.
 *
 * Every extracted value carries provenance so the review UI can show where it
 * came from, and sensitive application answers (work authorisation, salary,
 * EEO) are only ever filled from fields the user stated explicitly.
 */

export const provenance = z.enum(["parsed", "llm", "user"]);
export type Provenance = z.infer<typeof provenance>;

const sourced = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    value,
    source: provenance,
    /** 0..1, how confident extraction was. User-entered values are 1. */
    confidence: z.number().min(0).max(1),
  });

export const experienceSchema = z.object({
  title: z.string(),
  company: z.string(),
  start: z.string().optional(),
  end: z.string().optional(),
  bullets: z.array(z.string()).default([]),
});

export const educationSchema = z.object({
  degree: z.string(),
  institution: z.string(),
  start: z.string().optional(),
  end: z.string().optional(),
});

export const candidateProfileSchema = z.object({
  schemaVersion: z.literal(1),
  contact: z.object({
    fullName: sourced(z.string()).optional(),
    firstName: sourced(z.string()).optional(),
    lastName: sourced(z.string()).optional(),
    email: sourced(z.string().email()).optional(),
    phone: sourced(z.string()).optional(),
    location: sourced(z.string()).optional(),
    linkedin: sourced(z.string().url()).optional(),
    github: sourced(z.string().url()).optional(),
    website: sourced(z.string().url()).optional(),
  }),
  summary: z.string().optional(),
  experience: z.array(experienceSchema).default([]),
  education: z.array(educationSchema).default([]),
  skills: z.array(z.string()).default([]),
  totalYearsExperience: sourced(z.number().nonnegative()).optional(),
  /**
   * Application preferences. Never inferred from the resume: these are only
   * set by the user, and the decision layer refuses to guess them.
   */
  preferences: z
    .object({
      workAuthorization: z.record(z.string(), z.boolean()).optional(), // country -> authorised
      needsSponsorship: z.boolean().optional(),
      salaryExpectation: z.string().optional(),
      noticePeriod: z.string().optional(),
      earliestStartDate: z.string().optional(),
      willingToRelocate: z.boolean().optional(),
      referralSource: z.string().optional(),
      /** Canned answers keyed by normalised question text. */
      savedAnswers: z.record(z.string(), z.string()).optional(),
    })
    .default({}),
});

export type CandidateProfile = z.infer<typeof candidateProfileSchema>;
export type SourcedValue<T> = { value: T; source: Provenance; confidence: number };

export function emptyProfile(): CandidateProfile {
  return candidateProfileSchema.parse({ schemaVersion: 1, contact: {} });
}
