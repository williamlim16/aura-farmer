"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createClient } from "~/lib/supabase/server";
import { db } from "~/server/db";
import {
  educations,
  experiences,
  userProfiles,
  type Education,
  type Experience,
  type UserProfile,
} from "~/server/db/schema";

export type ActionResult<T> =
  { ok: true; data: T } | { ok: false; error: string };

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .transform((val) => (val.length > 0 ? val : null));

const optionalUrl = (label: string) =>
  z
    .string()
    .trim()
    .max(512, `${label} must be 512 characters or fewer.`)
    .refine(
      (val) => {
        if (!val) return true;
        try {
          const parsed = new URL(val);
          return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: `Enter a valid ${label} starting with https:// or http://.` },
    )
    .transform((val) => (val.length > 0 ? val : null));

const personalProfileSchema = z.object({
  fullName: optionalText(256, "Full name"),
  headline: optionalText(256, "Headline"),
  location: optionalText(256, "Location"),
  phone: optionalText(64, "Phone number"),
  websiteUrl: optionalUrl("website URL"),
  linkedinUrl: optionalUrl("LinkedIn URL"),
  githubUrl: optionalUrl("GitHub URL"),
  summary: optionalText(4000, "Personal summary"),
  skills: optionalText(2000, "Skills"),
});

const experienceSchema = z.object({
  id: z.string().uuid().optional(),
  jobTitle: z
    .string()
    .trim()
    .min(1, "Job title is required.")
    .max(256, "Job title must be 256 characters or fewer."),
  company: z
    .string()
    .trim()
    .min(1, "Company name is required.")
    .max(256, "Company name must be 256 characters or fewer."),
  employmentType: optionalText(128, "Employment type"),
  location: optionalText(256, "Location"),
  startDate: z
    .string()
    .trim()
    .min(1, "Start date is required.")
    .max(64, "Start date must be 64 characters or fewer."),
  endDate: optionalText(64, "End date"),
  isCurrent: z.boolean().default(false),
  description: optionalText(4000, "Description"),
});

const educationSchema = z.object({
  id: z.string().uuid().optional(),
  school: z
    .string()
    .trim()
    .min(1, "School or institution is required.")
    .max(256, "School name must be 256 characters or fewer."),
  degree: z
    .string()
    .trim()
    .min(1, "Degree or program is required.")
    .max(256, "Degree must be 256 characters or fewer."),
  fieldOfStudy: optionalText(256, "Field of study"),
  location: optionalText(256, "Location"),
  startDate: z
    .string()
    .trim()
    .min(1, "Start date is required.")
    .max(64, "Start date must be 64 characters or fewer."),
  endDate: optionalText(64, "End date"),
  isCurrent: z.boolean().default(false),
  grade: optionalText(128, "Grade or GPA"),
  description: optionalText(4000, "Description"),
});

const uuidSchema = z.string().uuid("Invalid item identifier.");

export type PersonalProfileInput = z.input<typeof personalProfileSchema>;
export type ExperienceInput = z.input<typeof experienceSchema>;
export type EducationInput = z.input<typeof educationSchema>;

async function getAuthenticatedUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (
    !error &&
    typeof data?.claims?.sub === "string" &&
    data.claims.sub.length > 0
  ) {
    return data.claims.sub;
  }

  const { data: userData } = await supabase.auth.getUser();
  return userData.user?.id ?? null;
}

/** Creates or updates the authenticated user's profile and personal summary. */
export async function upsertUserProfileAction(
  input: PersonalProfileInput,
): Promise<ActionResult<UserProfile>> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { ok: false, error: "Please sign in again to save your profile." };
  }

  const parsed = personalProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid profile input.",
    };
  }

  try {
    const [saved] = await db
      .insert(userProfiles)
      .values({
        userId,
        ...parsed.data,
      })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: {
          ...parsed.data,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!saved) {
      return { ok: false, error: "Unable to save profile details." };
    }

    revalidatePath("/profile");
    return { ok: true, data: saved };
  } catch (err) {
    console.error("Failed to upsert user profile:", err);
    return {
      ok: false,
      error:
        "Could not save your profile to the database. Ensure the database is running and migrated.",
    };
  }
}

/** Creates or updates a work experience entry for the authenticated user. */
export async function saveExperienceAction(
  input: ExperienceInput,
): Promise<ActionResult<Experience>> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return {
      ok: false,
      error: "Please sign in again to save work experience.",
    };
  }

  const parsed = experienceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid experience input.",
    };
  }

  const { id, ...fields } = parsed.data;
  const endDate = fields.isCurrent ? null : fields.endDate;

  try {
    if (id) {
      const [updated] = await db
        .update(experiences)
        .set({
          jobTitle: fields.jobTitle,
          company: fields.company,
          employmentType: fields.employmentType,
          location: fields.location,
          startDate: fields.startDate,
          endDate,
          isCurrent: fields.isCurrent,
          description: fields.description,
          updatedAt: new Date(),
        })
        .where(and(eq(experiences.id, id), eq(experiences.userId, userId)))
        .returning();

      if (!updated) {
        return { ok: false, error: "Experience entry could not be found." };
      }

      revalidatePath("/profile");
      return { ok: true, data: updated };
    }

    const [created] = await db
      .insert(experiences)
      .values({
        userId,
        jobTitle: fields.jobTitle,
        company: fields.company,
        employmentType: fields.employmentType,
        location: fields.location,
        startDate: fields.startDate,
        endDate,
        isCurrent: fields.isCurrent,
        description: fields.description,
      })
      .returning();

    if (!created) {
      return { ok: false, error: "Unable to create experience entry." };
    }

    revalidatePath("/profile");
    return { ok: true, data: created };
  } catch (err) {
    console.error("Failed to save experience:", err);
    return {
      ok: false,
      error:
        "Could not save work experience. Ensure the database is running and migrated.",
    };
  }
}

/** Deletes a work experience entry owned by the authenticated user. */
export async function deleteExperienceAction(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return {
      ok: false,
      error: "Please sign in again to delete work experience.",
    };
  }

  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) {
    return { ok: false, error: "Invalid experience identifier." };
  }

  try {
    const [deleted] = await db
      .delete(experiences)
      .where(
        and(eq(experiences.id, parsedId.data), eq(experiences.userId, userId)),
      )
      .returning({ id: experiences.id });

    if (!deleted) {
      return { ok: false, error: "Experience entry could not be found." };
    }

    revalidatePath("/profile");
    return { ok: true, data: deleted };
  } catch (err) {
    console.error("Failed to delete experience:", err);
    return {
      ok: false,
      error: "Could not delete work experience from the database.",
    };
  }
}

/** Creates or updates an education entry for the authenticated user. */
export async function saveEducationAction(
  input: EducationInput,
): Promise<ActionResult<Education>> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { ok: false, error: "Please sign in again to save education." };
  }

  const parsed = educationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid education input.",
    };
  }

  const { id, ...fields } = parsed.data;
  const endDate = fields.isCurrent ? null : fields.endDate;

  try {
    if (id) {
      const [updated] = await db
        .update(educations)
        .set({
          school: fields.school,
          degree: fields.degree,
          fieldOfStudy: fields.fieldOfStudy,
          location: fields.location,
          startDate: fields.startDate,
          endDate,
          isCurrent: fields.isCurrent,
          grade: fields.grade,
          description: fields.description,
          updatedAt: new Date(),
        })
        .where(and(eq(educations.id, id), eq(educations.userId, userId)))
        .returning();

      if (!updated) {
        return { ok: false, error: "Education entry could not be found." };
      }

      revalidatePath("/profile");
      return { ok: true, data: updated };
    }

    const [created] = await db
      .insert(educations)
      .values({
        userId,
        school: fields.school,
        degree: fields.degree,
        fieldOfStudy: fields.fieldOfStudy,
        location: fields.location,
        startDate: fields.startDate,
        endDate,
        isCurrent: fields.isCurrent,
        grade: fields.grade,
        description: fields.description,
      })
      .returning();

    if (!created) {
      return { ok: false, error: "Unable to create education entry." };
    }

    revalidatePath("/profile");
    return { ok: true, data: created };
  } catch (err) {
    console.error("Failed to save education:", err);
    return {
      ok: false,
      error:
        "Could not save education entry. Ensure the database is running and migrated.",
    };
  }
}

/** Deletes an education entry owned by the authenticated user. */
export async function deleteEducationAction(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { ok: false, error: "Please sign in again to delete education." };
  }

  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) {
    return { ok: false, error: "Invalid education identifier." };
  }

  try {
    const [deleted] = await db
      .delete(educations)
      .where(
        and(eq(educations.id, parsedId.data), eq(educations.userId, userId)),
      )
      .returning({ id: educations.id });

    if (!deleted) {
      return { ok: false, error: "Education entry could not be found." };
    }

    revalidatePath("/profile");
    return { ok: true, data: deleted };
  } catch (err) {
    console.error("Failed to delete education:", err);
    return {
      ok: false,
      error: "Could not delete education entry from the database.",
    };
  }
}
