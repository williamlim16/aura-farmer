/**
 * Framework-independent API handlers for the apply workflow. Routes resolve
 * the Supabase user and call these; tests call them with fake users. Every
 * handler takes the caller's userId and only touches that user's data.
 */
import { z } from "zod";

import { findTarget } from "~/lib/applications/targets";
import { applyReview, CONTACT_FIELDS, toReview, type ProfileReview } from "~/lib/profile/review";
import type { CandidateProfile } from "~/lib/profile/schema";
import { RepoError, type ApplicationRecord, type Repos } from "~/server/repos/types";
import type { ObjectStorage } from "~/server/storage/types";
import { JobError, type JobQueue } from "~/server/jobs/types";
import { ingestResume } from "~/server/workflow/ingest";

export interface ApiDeps {
  repos: Repos;
  storage: ObjectStorage;
  queue?: Pick<JobQueue, "enqueue" | "cancel" | "latest">;
}

export type ApiResult<T = unknown> = { status: number; body: T };

const err = (status: number, error: string, code: string): ApiResult<{ error: string; code: string }> => ({ status, body: { error, code } });
const unauth = () => err(401, "Please sign in.", "unauthenticated");

export function repoErrorToResult(e: unknown): ApiResult {
  if (e instanceof JobError) {
    const status = { not_found: 404, already_active: 409, lease_lost: 409 }[e.code];
    return err(status, e.message, e.code);
  }
  if (e instanceof RepoError) {
    const status = { not_found: 404, conflict: 409, invalid_transition: 409, config: 500 }[e.code];
    return err(status, e.code === "config" ? "Server is not configured." : e.message, e.code);
  }
  throw e;
}

// ---------- Profile ----------

/**
 * A fresh resume parse replaces resume-derived facts but keeps what only the
 * user can state: preferences and any contact field they confirmed.
 */
export function mergeReparsed(parsed: CandidateProfile, existing: CandidateProfile | undefined): CandidateProfile {
  if (!existing) return parsed;
  const next = structuredClone(parsed);
  next.preferences = structuredClone(existing.preferences);
  for (const k of CONTACT_FIELDS) {
    const v = existing.contact[k];
    if (v?.source === "user") next.contact[k] = structuredClone(v);
  }
  return next;
}

export async function ingestHandler(userId: string | null, file: unknown, deps: ApiDeps): Promise<ApiResult> {
  if (!userId) return unauth();
  const result = await ingestResume({ userId, file, storage: deps.storage });
  if (!result.ok) return err(result.status, result.error, result.code);
  try {
    const resume = await deps.repos.resumes.create(userId, {
      storageKey: result.resume.path,
      kind: result.resume.kind,
      filename: result.resume.filename.slice(0, 255),
      sizeBytes: (await deps.storage.get(result.resume.path))?.byteLength ?? 0,
    });
    const existing = await deps.repos.profiles.get(userId);
    const saved = await deps.repos.profiles.save(userId, mergeReparsed(result.profile, existing?.profile), { resumeId: resume.id });
    return {
      status: 201,
      body: { success: true, path: resume.storageKey, resume: publicResume(resume), missing: result.missing, review: toReview(saved.profile), version: saved.version },
    };
  } catch (e) {
    // Do not leave an orphaned object if the database write failed.
    await deps.storage.delete(result.resume.path).catch(() => undefined);
    return repoErrorToResult(e);
  }
}

function publicResume(r: { id: string; filename: string; kind: string; sizeBytes: number; createdAt: Date }) {
  return { id: r.id, filename: r.filename, kind: r.kind, sizeBytes: r.sizeBytes, createdAt: r.createdAt.toISOString() };
}

export async function getProfileHandler(userId: string | null, deps: ApiDeps): Promise<ApiResult> {
  if (!userId) return unauth();
  const rec = await deps.repos.profiles.get(userId);
  if (!rec) return { status: 200, body: { profile: null } };
  const resume = rec.resumeId ? await deps.repos.resumes.get(userId, rec.resumeId) : null;
  return { status: 200, body: { review: toReview(rec.profile), version: rec.version, resume: resume ? publicResume(resume) : null, updatedAt: rec.updatedAt.toISOString() } };
}

const str = z.string().max(4000);
const yn = z.enum(["", "yes", "no"]);
const row = <K extends string>(keys: readonly K[]) => z.object(Object.fromEntries(keys.map((k) => [k, z.string().max(200)])) as Record<K, z.ZodString>);
export const profileUpdateSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    contact: z.object(Object.fromEntries(CONTACT_FIELDS.map((k) => [k, z.string().max(300).optional()])) as Record<(typeof CONTACT_FIELDS)[number], z.ZodOptional<z.ZodString>>).partial().optional(),
    summary: str.optional(),
    totalYearsExperience: z.string().max(10).optional(),
    skills: str.optional(),
    experience: z.array(row(["title", "company", "start", "end"] as const)).max(20).optional(),
    education: z.array(row(["degree", "institution", "start", "end"] as const)).max(10).optional(),
    preferences: z
      .object({
        workAuthCountry: z.string().max(60),
        workAuthorized: yn,
        needsSponsorship: yn,
        salaryExpectation: z.string().max(200),
        noticePeriod: z.string().max(200),
        earliestStartDate: z.string().max(200),
        willingToRelocate: yn,
        referralSource: z.string().max(200),
      })
      .partial()
      .optional(),
  })
  .strict();

export async function putProfileHandler(userId: string | null, body: unknown, deps: ApiDeps): Promise<ApiResult> {
  if (!userId) return unauth();
  const parsed = profileUpdateSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: "Invalid profile update.", code: "invalid_body", issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })) } };
  const { expectedVersion, ...review } = parsed.data;
  const rec = await deps.repos.profiles.get(userId);
  if (!rec) return err(409, "Upload a resume first.", "no_profile");
  const merged = applyReview(rec.profile, review);
  if (!merged.ok) return { status: 422, body: { error: "Some fields are invalid.", code: "invalid_fields", errors: merged.errors } };
  try {
    const saved = await deps.repos.profiles.save(userId, merged.profile, { expectedVersion });
    return { status: 200, body: { review: toReview(saved.profile) satisfies ProfileReview, version: saved.version } };
  } catch (e) {
    return repoErrorToResult(e);
  }
}

// ---------- Applications ----------

/** What the client may see. Profile snapshot and internal ids are not returned in lists. */
export function publicApplication(a: ApplicationRecord, opts: { full?: boolean } = {}) {
  return {
    id: a.id,
    targetKey: a.targetKey,
    title: a.title,
    company: a.company,
    status: a.status,
    useLlm: a.useLlm,
    error: a.error,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    submittedAt: a.submittedAt?.toISOString() ?? null,
    summary: a.report ? { verified: a.report.metrics.verified, needsHuman: a.report.metrics.needsHuman, problems: a.report.metrics.errors + a.report.metrics.mismatches } : null,
    ...(opts.full ? { report: a.report } : {}),
  };
}

export const createApplicationSchema = z.object({ targetKey: z.string().max(100), useLlm: z.boolean().default(false), start: z.boolean().default(true) }).strict();

export async function createApplicationHandler(userId: string | null, body: unknown, deps: ApiDeps): Promise<ApiResult> {
  if (!userId) return unauth();
  const parsed = createApplicationSchema.safeParse(body);
  if (!parsed.success) return err(400, "Invalid request.", "invalid_body");
  const target = findTarget(parsed.data.targetKey);
  if (!target) return err(400, "Choose one of the available test forms.", "unknown_target");
  const profile = await deps.repos.profiles.get(userId);
  if (!profile) return err(409, "Upload a resume and review your profile first.", "no_profile");
  const resume = profile.resumeId ? await deps.repos.resumes.get(userId, profile.resumeId) : await deps.repos.resumes.latest(userId);
  try {
    let app = await deps.repos.applications.create(userId, {
      targetKey: target.key,
      targetUrl: `test-form:${target.file}`,
      title: target.title,
      company: target.company,
      useLlm: parsed.data.useLlm,
      profileSnapshot: profile.profile,
      resumeId: resume?.id ?? null,
    });
    if (parsed.data.start) {
      if (!deps.queue) return err(503, "The browser worker queue is not configured.", "no_queue");
      await deps.queue.enqueue(userId, app.id);
      app = (await deps.repos.applications.get(userId, app.id)) ?? app;
    }
    return { status: 201, body: { application: publicApplication(app, { full: true }) } };
  } catch (e) {
    return repoErrorToResult(e);
  }
}

export async function listApplicationsHandler(userId: string | null, deps: ApiDeps): Promise<ApiResult> {
  if (!userId) return unauth();
  const apps = await deps.repos.applications.list(userId, { limit: 50 });
  return { status: 200, body: { applications: apps.map((a) => publicApplication(a)) } };
}

export async function getApplicationHandler(userId: string | null, id: string, deps: ApiDeps): Promise<ApiResult> {
  if (!userId) return unauth();
  const app = await deps.repos.applications.get(userId, id);
  if (!app) return err(404, "Application not found.", "not_found");
  return { status: 200, body: { application: publicApplication(app, { full: true }) } };
}

export const applicationActionSchema = z.object({ action: z.enum(["rerun", "cancel", "mark_submitted"]), useLlm: z.boolean().optional() }).strict();

/**
 * User actions on an application. "mark_submitted" records that the USER
 * submitted the form themselves; the system never submits.
 */
export async function applicationActionHandler(userId: string | null, id: string, body: unknown, deps: ApiDeps): Promise<ApiResult> {
  if (!userId) return unauth();
  const parsed = applicationActionSchema.safeParse(body);
  if (!parsed.success) return err(400, "Invalid action.", "invalid_body");
  const app = await deps.repos.applications.get(userId, id);
  if (!app) return err(404, "Application not found.", "not_found");
  try {
    switch (parsed.data.action) {
      case "mark_submitted":
        await deps.repos.applications.update(userId, id, { status: "submitted_by_user" });
        break;
      case "cancel": {
        if (!deps.queue) return err(503, "The browser worker queue is not configured.", "no_queue");
        const ok = await deps.queue.cancel(userId, id);
        if (!ok) return err(409, "Nothing to cancel.", "not_active");
        break;
      }
      case "rerun": {
        if (!deps.queue) return err(503, "The browser worker queue is not configured.", "no_queue");
        // Re-runs use the latest reviewed profile.
        const profile = await deps.repos.profiles.get(userId);
        if (profile) await deps.repos.applications.update(userId, id, { profileSnapshot: profile.profile, ...(parsed.data.useLlm !== undefined ? { useLlm: parsed.data.useLlm } : {}) });
        await deps.queue.enqueue(userId, id);
        break;
      }
    }
    const fresh = await deps.repos.applications.get(userId, id);
    return { status: 200, body: { application: publicApplication(fresh!, { full: true }) } };
  } catch (e) {
    return repoErrorToResult(e);
  }
}

export async function applicationLogsHandler(userId: string | null, id: string, deps: ApiDeps): Promise<ApiResult> {
  if (!userId) return unauth();
  const app = await deps.repos.applications.get(userId, id);
  if (!app) return err(404, "Application not found.", "not_found");
  const latest = deps.queue ? await deps.queue.latest(userId, id) : null;
  return {
    status: 200,
    body: {
      status: app.status,
      job: latest ? { status: latest.job.status, attempts: latest.job.attempts, maxAttempts: latest.job.maxAttempts, cancelRequested: latest.job.cancelRequested, updatedAt: latest.job.updatedAt.toISOString() } : null,
      logs: (latest?.logs ?? []).map((l) => ({ at: l.at.toISOString(), level: l.level, message: l.message })),
    },
  };
}
