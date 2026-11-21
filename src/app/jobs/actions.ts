"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  TRACKING_STATUSES,
  TRACKING_STATUS_META,
  type TrackingStatus,
} from "~/lib/tracking-status";
import { requireUser } from "~/server/auth";
import {
  addKeyword,
  fetchMissingDescriptions,
  fetchMissingRecommendations,
  getKeywords,
  MAX_KEYWORDS,
  refreshJobsForUser,
  removeKeyword,
  researchJobForUser,
  setJobsTracked,
  setJobTrackingStatus,
} from "~/server/jobs";
import {
  recompileTailoredResume,
  tailorResumeForJob,
} from "~/server/tailored-resumes";

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

const trackJobStatusSchema = z.object({
  jobIds: z.array(z.number().int().positive()).min(1).max(200),
  status: z.enum(TRACKING_STATUSES),
});

export async function setJobTrackingStatusAction(input: {
  jobIds: number[];
  status: TrackingStatus;
}): Promise<ActionState> {
  const user = await requireUser();

  const parsed = trackJobStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Invalid tracking status." };
  }

  try {
    await setJobTrackingStatus(user.id, parsed.data.jobIds, parsed.data.status);
    revalidatePath("/jobs", "layout");
    revalidatePath("/tracking");
    return {
      ok: true,
      message: `Status updated to ${TRACKING_STATUS_META[parsed.data.status].label}.`,
    };
  } catch (err) {
    console.error("setJobTrackingStatusAction failed", err);
    return {
      ok: false,
      message: "Could not update tracking status. Please try again.",
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

export interface RecommendationsState extends ActionState {
  /** Roles researched in this batch. */
  found: number;
  /** Tracked roles still missing company recommendations. */
  remaining: number;
  /** False when no jobs were attempted — callers should stop looping. */
  progressed: boolean;
}

/** Run Tavily company research for the next batch of tracked jobs missing recommendations. */
export async function fetchRecommendationsAction(): Promise<RecommendationsState> {
  const user = await requireUser();

  try {
    const { attempted, found, remaining } = await fetchMissingRecommendations(
      user.id,
    );
    revalidatePath("/jobs", "layout");
    revalidatePath("/tracking");
    return {
      ok: true,
      message: `Researched ${found} role${found === 1 ? "" : "s"}.`,
      found,
      remaining,
      progressed: attempted > 0,
    };
  } catch (err) {
    console.error("fetchRecommendationsAction failed", err);
    return {
      ok: false,
      message: "Couldn't complete company research. Please try again.",
      found: 0,
      remaining: -1,
      progressed: false,
    };
  }
}

const researchJobSchema = z.object({
  jobId: z.number().int().positive(),
});

/** Run Tavily company research and recommendations for a single job posting. */
export async function researchJobAction(input: {
  jobId: number;
}): Promise<ActionState & { recommendation?: string | null }> {
  const user = await requireUser();

  const parsed = researchJobSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Invalid job selection." };
  }

  try {
    const { status, recommendation } = await researchJobForUser(
      user.id,
      parsed.data.jobId,
    );
    revalidatePath("/jobs", "layout");
    revalidatePath("/tracking");

    if (status === "found" && recommendation) {
      return {
        ok: true,
        message: "Company research updated.",
        recommendation,
      };
    }

    return {
      ok: false,
      message: "Couldn't complete company research. Please try again.",
    };
  } catch (err) {
    console.error("researchJobAction failed", err);
    return {
      ok: false,
      message: "Couldn't complete company research. Please try again.",
    };
  }
}

export interface TailorActionState extends ActionState {
  /** True when a PDF is now available (false: only the .tex was produced). */
  pdf: boolean;
}

const jobIdSchema = z.number().int().positive();

/** Tailors the user's resume to one tracked job (LLM + one PDF compile). */
export async function tailorResumeAction(
  jobId: number,
): Promise<TailorActionState> {
  const user = await requireUser();
  const parsed = jobIdSchema.safeParse(jobId);
  if (!parsed.success)
    return { ok: false, pdf: false, message: "Invalid job." };

  try {
    const result = await tailorResumeForJob(user, parsed.data);
    revalidatePath("/jobs/tracking");
    return { pdf: false, ...result };
  } catch (err) {
    console.error("tailorResumeAction failed", err);
    return {
      ok: false,
      pdf: false,
      message: "Couldn't tailor your resume. Please try again.",
    };
  }
}

/** Retries only the PDF compile for an already-tailored resume. */
export async function compileTailoredResumeAction(
  jobId: number,
): Promise<TailorActionState> {
  const user = await requireUser();
  const parsed = jobIdSchema.safeParse(jobId);
  if (!parsed.success)
    return { ok: false, pdf: false, message: "Invalid job." };

  try {
    const result = await recompileTailoredResume(user.id, parsed.data);
    revalidatePath("/jobs/tracking");
    return { pdf: false, ...result };
  } catch (err) {
    console.error("compileTailoredResumeAction failed", err);
    return {
      ok: false,
      pdf: false,
      message: "Couldn't compile the PDF. Please try again.",
    };
  }
}
