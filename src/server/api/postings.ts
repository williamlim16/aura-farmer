/**
 * Job posting workflow handlers: import (URL or manual) -> review -> match ->
 * tailor -> tailored resume -> prepare application. Framework-free; every
 * call is scoped to the caller's user id.
 */
import { z } from "zod";

import { findTarget } from "~/lib/applications/targets";
import { matchProfileToPosting, type MatchResult } from "~/lib/match/match";
import type { PostingDraft } from "~/lib/postings/types";
import { applyTailoring, suggestTailoring, type Tailoring } from "~/lib/tailor/tailor";
import { renderResumePdf } from "~/server/resume/pdf";
import { draftFromManual, previewFromUrl } from "~/server/postings/intake";
import type { RateLimiter } from "~/server/postings/rate-limit";
import type { SafeFetchOptions } from "~/server/postings/safe-fetch";
import type { PostingRecord } from "~/server/repos/types";
import { JobError } from "~/server/jobs/types";
import { MAX_ACTIVE_RUNS_PER_USER, publicApplication, repoErrorToResult, type ApiDeps, type ApiResult } from "./handlers";

const err = (status: number, error: string, code: string): ApiResult => ({ status, body: { error, code } });
const unauth = () => err(401, "Please sign in.", "unauthenticated");

export function publicPosting(p: PostingRecord) {
  return { ...p, userId: undefined, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() };
}

const reqList = z.array(z.string().trim().min(1).max(400)).max(40);
const requirementsSchema = z.object({ required: reqList, preferred: reqList });

export const previewSchema = z.object({ url: z.string().max(2000) }).strict();
export async function previewPostingHandler(userId: string | null, body: unknown, o: SafeFetchOptions & { limiter?: RateLimiter } = {}): Promise<ApiResult> {
  if (!userId) return unauth();
  const p = previewSchema.safeParse(body);
  if (!p.success) return err(400, "Send a job posting URL.", "invalid_body");
  const r = await previewFromUrl(userId, p.data.url, o);
  return r.ok ? { status: 200, body: { draft: r.draft } } : err(r.status, r.error, r.code);
}

export const saveSchema = z.union([
  z.object({
    kind: z.literal("imported"),
    draft: z.object({
      source: z.enum(["greenhouse", "lever", "ashby"]),
      sourceUrl: z.string().url().max(2000),
      externalId: z.string().max(200),
      title: z.string().trim().min(1).max(300),
      company: z.string().trim().min(1).max(200),
      location: z.string().max(200),
      description: z.string().min(1).max(50_000),
      requirements: requirementsSchema,
    }),
  }).strict(),
  z.object({
    kind: z.literal("manual"),
    title: z.string().trim().min(1).max(300),
    company: z.string().trim().min(1).max(200),
    location: z.string().max(200).optional(),
    description: z.string().trim().min(40, "Paste the full job description (at least a few sentences).").max(50_000),
    url: z.string().url().max(2000).optional(),
  }).strict(),
]);

export async function savePostingHandler(userId: string | null, body: unknown, deps: ApiDeps): Promise<ApiResult> {
  if (!userId) return unauth();
  const p = saveSchema.safeParse(body);
  if (!p.success) return { status: 400, body: { error: p.error.issues[0]?.message ?? "Invalid posting.", code: "invalid_body" } };
  // Imported drafts keep the provenance "live_api"; the user may have edited fields during review.
  const draft: PostingDraft = p.data.kind === "manual" ? draftFromManual(p.data) : { ...p.data.draft, retrieval: "live_api" };
  const { record, existed } = await deps.repos.postings.create(userId, draft);
  return { status: existed ? 200 : 201, body: { posting: publicPosting(record), existed } };
}

export const updatePostingSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  company: z.string().trim().min(1).max(200).optional(),
  location: z.string().max(200).optional(),
  requirements: requirementsSchema.optional(),
}).strict();

export async function updatePostingHandler(userId: string | null, id: string, body: unknown, deps: ApiDeps): Promise<ApiResult> {
  if (!userId) return unauth();
  const p = updatePostingSchema.safeParse(body);
  if (!p.success) return err(400, "Invalid update.", "invalid_body");
  try {
    // Edited requirements invalidate a previous match/tailoring.
    const patch = p.data.requirements ? { ...p.data, match: null, tailoring: null } : p.data;
    return { status: 200, body: { posting: publicPosting(await deps.repos.postings.update(userId, id, patch)) } };
  } catch (e) {
    return repoErrorToResult(e);
  }
}

export async function matchPostingHandler(userId: string | null, id: string, deps: ApiDeps): Promise<ApiResult> {
  if (!userId) return unauth();
  const [posting, profile] = await Promise.all([deps.repos.postings.get(userId, id), deps.repos.profiles.get(userId)]);
  if (!posting) return err(404, "Job posting not found.", "not_found");
  if (!profile) return err(409, "Upload a resume and review your profile first.", "no_profile");
  const match = matchProfileToPosting(profile.profile, posting.requirements);
  const saved = await deps.repos.postings.update(userId, id, { match });
  return { status: 200, body: { posting: publicPosting(saved) } };
}

export async function tailorPostingHandler(userId: string | null, id: string, deps: ApiDeps): Promise<ApiResult> {
  if (!userId) return unauth();
  const [posting, profile] = await Promise.all([deps.repos.postings.get(userId, id), deps.repos.profiles.get(userId)]);
  if (!posting) return err(404, "Job posting not found.", "not_found");
  if (!profile) return err(409, "Upload a resume and review your profile first.", "no_profile");
  const match = (posting.match as MatchResult | null) ?? matchProfileToPosting(profile.profile, posting.requirements);
  const tailoring = suggestTailoring(profile.profile, posting, match);
  const saved = await deps.repos.postings.update(userId, id, { match, tailoring });
  return { status: 200, body: { posting: publicPosting(saved) } };
}

export const decideSchema = z.object({
  suggestions: z.record(z.string().max(40), z.enum(["accepted", "rejected", "pending"])).optional(),
  answers: z.record(z.string().max(40), z.object({ status: z.enum(["accepted", "rejected", "pending"]), answer: z.string().max(3000).optional() })).optional(),
}).strict();

export async function decideTailoringHandler(userId: string | null, id: string, body: unknown, deps: ApiDeps): Promise<ApiResult> {
  if (!userId) return unauth();
  const p = decideSchema.safeParse(body);
  if (!p.success) return err(400, "Invalid decisions.", "invalid_body");
  const posting = await deps.repos.postings.get(userId, id);
  if (!posting?.tailoring) return err(posting ? 409 : 404, posting ? "Generate suggestions first." : "Job posting not found.", posting ? "no_tailoring" : "not_found");
  const t = structuredClone(posting.tailoring as Tailoring);
  for (const s of t.suggestions) {
    const d = p.data.suggestions?.[s.id];
    if (d) s.status = d;
  }
  for (const a of t.answers) {
    const d = p.data.answers?.[a.id];
    if (d) {
      a.status = d.status;
      if (d.answer !== undefined) a.answer = d.answer;
    }
  }
  t.tailoredResumeId = null; // decisions changed: the old PDF no longer reflects them
  const saved = await deps.repos.postings.update(userId, id, { tailoring: t });
  return { status: 200, body: { posting: publicPosting(saved) } };
}

/** Generate the tailored resume PDF from accepted suggestions (stored as a separate resume version). */
export async function generateTailoredResumeHandler(userId: string | null, id: string, deps: ApiDeps): Promise<ApiResult> {
  if (!userId) return unauth();
  const [posting, profile] = await Promise.all([deps.repos.postings.get(userId, id), deps.repos.profiles.get(userId)]);
  if (!posting) return err(404, "Job posting not found.", "not_found");
  if (!profile) return err(409, "Upload a resume first.", "no_profile");
  const t = posting.tailoring as Tailoring | null;
  if (!t) return err(409, "Generate suggestions first.", "no_tailoring");
  let tailored;
  try {
    tailored = applyTailoring(profile.profile, t);
  } catch (e) {
    return err(422, e instanceof Error ? e.message : "Tailoring failed verification.", "verification_failed");
  }
  const bytes = await renderResumePdf(tailored);
  const key = `${userId}/resumes/tailored-${crypto.randomUUID()}.pdf`;
  await deps.storage.put(key, bytes, "application/pdf");
  const safeCompany = posting.company.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40) || "job";
  const resume = await deps.repos.resumes.create(userId, { storageKey: key, kind: "pdf", filename: `resume-${safeCompany}-tailored.pdf`, sizeBytes: bytes.byteLength });
  const saved = await deps.repos.postings.update(userId, id, { tailoring: { ...t, tailoredResumeId: resume.id } });
  return { status: 201, body: { posting: publicPosting(saved), resumeId: resume.id } };
}

export const prepareSchema = z.object({ targetKey: z.string().max(100), useLlm: z.boolean().default(false), start: z.boolean().default(true) }).strict();

/**
 * Create an application for a posting: the snapshot is the tailored profile
 * (accepted suggestions + approved answers), and the resume is the tailored
 * PDF if generated, otherwise the original. Autofill runs against an
 * allow-listed target; real ATS pages are not automated.
 */
export async function preparePostingApplicationHandler(userId: string | null, id: string, body: unknown, deps: ApiDeps): Promise<ApiResult> {
  if (!userId) return unauth();
  const p = prepareSchema.safeParse(body);
  if (!p.success) return err(400, "Invalid request.", "invalid_body");
  const target = findTarget(p.data.targetKey);
  if (!target) return err(400, "Choose one of the available test forms.", "unknown_target");
  const [posting, profile] = await Promise.all([deps.repos.postings.get(userId, id), deps.repos.profiles.get(userId)]);
  if (!posting) return err(404, "Job posting not found.", "not_found");
  if (!profile) return err(409, "Upload a resume and review your profile first.", "no_profile");
  const t = posting.tailoring as Tailoring | null;
  let snapshot = profile.profile;
  try {
    if (t) snapshot = applyTailoring(profile.profile, t);
  } catch (e) {
    return err(422, e instanceof Error ? e.message : "Tailoring failed verification.", "verification_failed");
  }
  const resumeId = t?.tailoredResumeId ?? profile.resumeId ?? (await deps.repos.resumes.latest(userId))?.id ?? null;
  try {
    let app = await deps.repos.applications.create(userId, { targetKey: target.key, targetUrl: `test-form:${target.file}`, title: posting.title, company: posting.company, useLlm: p.data.useLlm, profileSnapshot: snapshot, resumeId, postingId: posting.id });
    if (p.data.start) {
      if (!deps.queue) return err(503, "The browser worker queue is not configured.", "no_queue");
      try {
        await deps.queue.enqueue(userId, app.id, { maxActivePerUser: MAX_ACTIVE_RUNS_PER_USER });
      } catch (e) {
        if (e instanceof JobError && e.code === "user_limit") return { status: 429, body: { error: e.message, code: "too_many_active", application: publicApplication(app, { full: true }) } };
        throw e;
      }
      app = (await deps.repos.applications.get(userId, app.id)) ?? app;
    }
    return { status: 201, body: { application: publicApplication(app, { full: true }) } };
  } catch (e) {
    return repoErrorToResult(e);
  }
}

export async function listPostingsHandler(userId: string | null, deps: ApiDeps): Promise<ApiResult> {
  if (!userId) return unauth();
  return { status: 200, body: { postings: (await deps.repos.postings.list(userId)).map(publicPosting) } };
}
export async function getPostingHandler(userId: string | null, id: string, deps: ApiDeps): Promise<ApiResult> {
  if (!userId) return unauth();
  const p = await deps.repos.postings.get(userId, id);
  return p ? { status: 200, body: { posting: publicPosting(p) } } : err(404, "Job posting not found.", "not_found");
}
export async function deletePostingHandler(userId: string | null, id: string, deps: ApiDeps): Promise<ApiResult> {
  if (!userId) return unauth();
  return (await deps.repos.postings.delete(userId, id)) ? { status: 200, body: { deleted: true } } : err(404, "Job posting not found.", "not_found");
}
