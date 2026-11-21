/**
 * The structured output Claude returns when tailoring a resume.
 *
 * Claude never writes LaTeX. It picks, orders and rewrites content into
 * these fields, and `renderResume` drops them into the fixed template. Facts
 * that must not change (name, contact details, employers, job titles, dates,
 * schools) aren't in this schema at all; the renderer reads them straight from
 * the user's profile, referenced by id.
 *
 * Uses `zod/v4` because the Anthropic SDK's structured-output helper requires
 * it (available in zod >= 3.25 alongside the v3 API the rest of the app uses).
 */

import { z } from "zod/v4";

/** Caps that keep the resume to roughly one page. Enforced after parsing. */
export const LIMITS = {
  summaryBullets: { min: 2, max: 4 },
  experiences: 4,
  experienceBullets: { min: 1, max: 4 },
  skillCategories: 4,
  skillsPerCategory: 12,
  titleChars: 40,
  textChars: 260,
} as const;

const bullet = z.object({
  title: z
    .string()
    .describe(
      `Short bold label, 1-3 words, no trailing colon (e.g. "Automation"). Max ${LIMITS.titleChars} characters.`,
    ),
  text: z
    .string()
    .describe(
      `One concise sentence, plain text (no LaTeX, no markdown). Max ${LIMITS.textChars} characters.`,
    ),
});

export const tailoredResumeSchema = z.object({
  summary: z
    .array(bullet)
    .describe(
      `${LIMITS.summaryBullets.min}-${LIMITS.summaryBullets.max} "Professional Summary" bullets aimed at this job.`,
    ),
  experiences: z
    .array(
      z.object({
        experienceId: z
          .string()
          .describe(
            "The id of an experience entry from the candidate profile.",
          ),
        bullets: z
          .array(bullet)
          .describe(
            `${LIMITS.experienceBullets.min}-${LIMITS.experienceBullets.max} bullets, most relevant to the job first.`,
          ),
      }),
    )
    .describe(
      `Up to ${LIMITS.experiences} of the candidate's experiences, most recent first.`,
    ),
  skills: z
    .array(
      z.object({
        category: z.string().describe('e.g. "Languages", "Tools".'),
        items: z.array(z.string()),
      }),
    )
    .describe(
      `Up to ${LIMITS.skillCategories} skill categories, most relevant to the job first.`,
    ),
  educationIds: z
    .array(z.string())
    .describe("Ids of the education entries to include, in display order."),
});

export type TailoredResume = z.infer<typeof tailoredResumeSchema>;
