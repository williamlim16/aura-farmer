"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "~/server/auth";
import {
  addKeyword,
  fetchMissingDescriptions,
  getKeywords,
  MAX_KEYWORDS,
  refreshJobsForUser,
  removeKeyword,
  setJobsTracked,
} from "~/server/jobs";

export interface ActionState {
  ok: boolean;
  message: string;
}

const keywordSchema = z
  .string()
  .trim()
  .min(2, "Job title must be at least 2 characters.")
  .max(120, "Job title must be 120 characters or fewer.");

export async function addKeywordAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const parsed = keywordSchema.safeParse(formData.get("keyword") ?? "");
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]!.message };
  }

  const existing = await getKeywords(user.id);
  if (existing.length >= MAX_KEYWORDS) {
    return {
      ok: false,
      message: `You can track up to ${MAX_KEYWORDS} job titles.`,
    };
  }

  await addKeyword(user.id, parsed.data);
  revalidatePath("/jobs", "layout");
  return { ok: true, message: `Added "${parsed.data}".` };
}

export async function removeKeywordAction(formData: FormData) {
  const user = await requireUser();
  const id = z.coerce.number().int().positive().safeParse(formData.get("id"));
  if (!id.success) return;

  await removeKeyword(user.id, id.data);
  revalidatePath("/jobs", "layout");
}

export async function refreshJobsAction(): Promise<ActionState> {
  const user = await requireUser();

  try {
    const { saved, added, descriptions, errors } = await refreshJobsForUser(
      user.id,
    );
    revalidatePath("/jobs", "layout");

    if (saved === 0 && errors.length > 0) {
      return { ok: false, message: errors.join(" · ") };
    }
    const base =
      `Found ${saved} job${saved === 1 ? "" : "s"}` +
      (saved > 0 ? ` (${added} new)` : "") +
      (descriptions > 0
        ? `, ${descriptions} description${descriptions === 1 ? "" : "s"} fetched.`
        : ".");
    return {
      ok: true,
      message: errors.length
        ? `${base} Some searches failed: ${errors.join(" · ")}`
        : base,
    };
  } catch (err) {
    console.error("refreshJobsAction failed", err);
    return { ok: false, message: "Job search failed. Please try again." };
  }
}

const trackJobsSchema = z.object({
  jobIds: z.array(z.number().int().positive()).min(1).max(200),
  tracked: z.boolean(),
});

export async function setJobsTrackedAction(input: {
  jobIds: number[];
  tracked: boolean;
}): Promise<ActionState> {
  const user = await requireUser();

  const parsed = trackJobsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Invalid job selection." };
  }

  try {
    await setJobsTracked(user.id, parsed.data.jobIds, parsed.data.tracked);
    revalidatePath("/jobs", "layout");
    revalidatePath("/tracking");
    return {
      ok: true,
      message: parsed.data.tracked
        ? "Added to tracking."
        : "Removed from tracking.",
    };
  } catch (err) {
    console.error("setJobsTrackedAction failed", err);
    return {
      ok: false,
      message: "Could not update tracking list. Please try again.",
    };
  }
}

export interface DescriptionsState extends ActionState {
  /** Descriptions fetched in this batch. */
  found: number;
  /** Jobs still without a description that are worth trying again. */
  remaining: number;
  /** False when the batch fetched nothing — callers should stop looping. */
  progressed: boolean;
}

/** Fetch descriptions for the next batch of jobs that are missing one. */
export async function fetchDescriptionsAction(): Promise<DescriptionsState> {
  const user = await requireUser();

  try {
    const { attempted, found, remaining } = await fetchMissingDescriptions(
      user.id,
    );
    revalidatePath("/jobs", "layout");
    return {
      ok: true,
      message: `Fetched ${found} description${found === 1 ? "" : "s"}.`,
      found,
      remaining,
      // Attempts count as progress too: failures are capped, so retrying
      // always moves toward `remaining` = 0.
      progressed: attempted > 0,
    };
  } catch (err) {
    console.error("fetchDescriptionsAction failed", err);
    return {
      ok: false,
      message: "Couldn't fetch descriptions. Please try again.",
      found: 0,
      remaining: -1,
      progressed: false,
    };
  }
}
