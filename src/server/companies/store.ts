import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { companySearches, jobs } from "~/server/db/schema";
import { MAX_DESCRIPTION_ATTEMPTS, setJobsTracked } from "~/server/jobs";
import { extractPages } from "~/server/tavily";
import type { CompanyResearchResult } from "./types";

/** A "running" row older than this is treated as dead (server restarted, timed out). */
const STALE_RUN_MS = 10 * 60_000;
/** `jobs.source` for roles added from company research. */
export const COMPANY_JOB_SOURCE = "company";

export type CompanySearchState = {
  preferences: string;
  status: "running" | "done" | "failed";
  progress: string | null;
  error: string | null;
  result: CompanyResearchResult | null;
  updatedAt: Date;
};

export async function getCompanySearch(
  userId: string,
): Promise<CompanySearchState | null> {
  const [row] = await db
    .select()
    .from(companySearches)
    .where(eq(companySearches.userId, userId));
  if (!row) return null;

  const stale =
    row.status === "running" &&
    Date.now() - row.updatedAt.getTime() > STALE_RUN_MS;
  const result = (row.result as CompanyResearchResult | null) ?? null;
  return {
    preferences: row.preferences,
    status: stale ? "failed" : (row.status as CompanySearchState["status"]),
    progress: stale ? null : row.progress,
    error: stale ? "The search timed out. Please try again." : row.error,
    // Results saved before requirement-based fit scoring can't be shown;
    // the user re-runs the search to get the new format.
    result: Array.isArray(result?.requirements) ? result : null,
    updatedAt: row.updatedAt,
  };
}

/**
 * Saves preferences and marks a run as started. Returns false if a run is
 * already in progress (the previous result is kept until the new one lands).
 */
export async function startCompanySearch(
  userId: string,
  preferences: string,
): Promise<boolean> {
  const current = await getCompanySearch(userId);
  if (current?.status === "running") return false;

  const now = new Date();
  await db
    .insert(companySearches)
    .values({
      userId,
      preferences,
      status: "running",
      progress: "Starting",
      startedAt: now,
    })
    .onConflictDoUpdate({
      target: companySearches.userId,
      set: {
        preferences,
        status: "running",
        progress: "Starting",
        error: null,
        startedAt: now,
        updatedAt: now,
      },
    });
  return true;
}

/**
 * Adds one researched open role to the user's jobs and tracking list, so it
 * can be tailored like any board listing. The role is read from the stored
 * result (never from the client). Its full description is fetched from the
 * posting page when the role has its own URL.
 */
export async function addCompanyRoleToJobs(
  userId: string,
  companyIndex: number,
  roleIndex: number,
): Promise<{ ok: boolean; message: string }> {
  const search = await getCompanySearch(userId);
  const company = search?.result?.companies[companyIndex];
  const role = company?.openRoles[roleIndex];
  if (!company || !role) {
    return { ok: false, message: "That role is no longer in your results." };
  }

  // Roles on a shared listing page carry a "#fragment"; their page text
  // describes many roles, so it isn't used as this role's description.
  const ownPage = !role.url.includes("#");
  let description: string | null = null;
  if (ownPage) {
    try {
      const pages = await extractPages([role.url], 2);
      const text = [...pages.values()][0]?.trim();
      if (text) description = text.slice(0, 20_000);
    } catch (err) {
      console.error("role description fetch failed", err);
    }
  }

  const values = {
    userId,
    keyword: `Company: ${company.name}`.slice(0, 120),
    source: COMPANY_JOB_SOURCE,
    title: role.title,
    url: role.url,
    company: company.name,
    location:
      [role.location, role.workArrangement, role.employmentType]
        .filter(Boolean)
        .join(" · ") || null,
    snippet: role.quote,
    description,
    // Nothing more to fetch for these; keeps them out of "Fetch descriptions".
    descriptionAttempts: MAX_DESCRIPTION_ATTEMPTS,
    fetchedAt: new Date(),
  };

  // Same posting may already be stored (e.g. found on Seek): reuse that row.
  const [inserted] = await db
    .insert(jobs)
    .values(values)
    .onConflictDoNothing({ target: [jobs.userId, jobs.url] })
    .returning({ id: jobs.id });
  const jobId =
    inserted?.id ??
    (
      await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.userId, userId), eq(jobs.url, role.url)))
    )[0]?.id;
  if (!jobId) return { ok: false, message: "Couldn't save the role." };

  await setJobsTracked(userId, [jobId], true);
  return {
    ok: true,
    message: description
      ? "Added to Tracking, ready to tailor."
      : "Added to Tracking. No full description was found, so tailoring will use the excerpt only.",
  };
}
