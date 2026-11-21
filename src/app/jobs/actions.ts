"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "~/server/auth";
import {
  addKeyword,
  getKeywords,
  MAX_KEYWORDS,
  refreshJobsForUser,
  removeKeyword,
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
  revalidatePath("/jobs");
  return { ok: true, message: `Added "${parsed.data}".` };
}

export async function removeKeywordAction(formData: FormData) {
  const user = await requireUser();
  const id = z.coerce.number().int().positive().safeParse(formData.get("id"));
  if (!id.success) return;

  await removeKeyword(user.id, id.data);
  revalidatePath("/jobs");
}

export async function refreshJobsAction(): Promise<ActionState> {
  const user = await requireUser();

  try {
    const { saved, removed, errors } = await refreshJobsForUser(user.id);
    revalidatePath("/jobs");

    if (saved === 0 && errors.length > 0) {
      return { ok: false, message: errors.join(" · ") };
    }
    const base =
      `Found ${saved} job${saved === 1 ? "" : "s"}` +
      (removed > 0 ? `, removed ${removed} no longer listed.` : ".");
    return {
      ok: true,
      message: errors.length ? `${base} Some searches failed: ${errors.join(" · ")}` : base,
    };
  } catch (err) {
    console.error("refreshJobsAction failed", err);
    return { ok: false, message: "Job search failed. Please try again." };
  }
}
