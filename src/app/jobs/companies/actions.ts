"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { requireUser } from "~/server/auth";
import { runCompanyResearch } from "~/server/companies/research";
import {
  addCompanyRoleToJobs,
  startCompanySearch,
} from "~/server/companies/store";

export interface ActionState {
  ok: boolean;
  message: string;
}

const preferencesSchema = z
  .string()
  .trim()
  .min(20, "Tell us a bit more about what you're looking for (20+ characters).")
  .max(4000, "Please keep preferences under 4,000 characters.");

/**
 * Saves the preferences and starts research in the background (it takes a
 * few minutes); the page polls the stored status until it's done.
 */
export async function startCompanySearchAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = preferencesSchema.safeParse(formData.get("preferences") ?? "");
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]!.message };
  }

  const started = await startCompanySearch(user.id, parsed.data);
  if (!started) {
    return { ok: false, message: "A search is already running." };
  }
  after(() => runCompanyResearch(user.id));

  revalidatePath("/jobs/companies");
  return { ok: true, message: "Research started. This takes 2–4 minutes." };
}

const indexSchema = z.number().int().min(0).max(50);

export async function addCompanyRoleAction(
  companyIndex: number,
  roleIndex: number,
): Promise<ActionState> {
  const user = await requireUser();
  const c = indexSchema.safeParse(companyIndex);
  const r = indexSchema.safeParse(roleIndex);
  if (!c.success || !r.success) return { ok: false, message: "Invalid role." };

  try {
    const result = await addCompanyRoleToJobs(user.id, c.data, r.data);
    revalidatePath("/jobs", "layout");
    return result;
  } catch (err) {
    console.error("addCompanyRoleAction failed", err);
    return { ok: false, message: "Couldn't add the role. Please try again." };
  }
}
