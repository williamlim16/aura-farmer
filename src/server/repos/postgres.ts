/**
 * Drizzle/Postgres repositories. Works with any Drizzle Postgres driver
 * (postgres-js in the app, PGlite in tests). Every query is filtered by
 * user_id because Drizzle connects as the table owner and bypasses RLS.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { canTransition, type ApplicationStatus } from "~/lib/applications/status";
import { candidateProfileSchema, type CandidateProfile } from "~/lib/profile/schema";
import type { ResumeKind } from "~/lib/resume/validate";
import type { PostingDraft, PostingSource } from "~/lib/postings/types";
import { applications, candidateProfiles, jobPostings, resumes } from "~/server/db/apply-schema";
import {
  RepoError,
  type ApplicationPatch,
  type ApplicationRecord,
  type ApplicationRepo,
  type NewApplication,
  type PostingPatch,
  type PostingRecord,
  type PostingRepo,
  type ProfileRepo,
  type Repos,
  type ResumeRecord,
  type ResumeRepo,
} from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<PgQueryResultHKT, any>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Non-UUID ids can never match; avoid a Postgres cast error and treat as missing. */
const validId = (id: string) => UUID_RE.test(id);

function toResume(r: typeof resumes.$inferSelect): ResumeRecord {
  return { ...r, kind: r.kind as ResumeKind };
}

function toApplication(r: typeof applications.$inferSelect): ApplicationRecord {
  return { ...r, status: r.status as ApplicationStatus, report: r.report ?? null };
}

/** JSONB from the DB is re-validated so a corrupt row cannot reach the engine. */
function parseProfile(p: unknown): CandidateProfile {
  return candidateProfileSchema.parse(p);
}

class PgResumeRepo implements ResumeRepo {
  constructor(private db: Db) {}
  async create(userId: string, input: Omit<ResumeRecord, "id" | "userId" | "createdAt">) {
    const [row] = await this.db.insert(resumes).values({ ...input, userId }).returning();
    return toResume(row!);
  }
  async get(userId: string, id: string) {
    if (!validId(id) || !validId(userId)) return null;
    const [row] = await this.db.select().from(resumes).where(and(eq(resumes.id, id), eq(resumes.userId, userId)));
    return row ? toResume(row) : null;
  }
  async latest(userId: string) {
    if (!validId(userId)) return null;
    const [row] = await this.db.select().from(resumes).where(eq(resumes.userId, userId)).orderBy(desc(resumes.createdAt)).limit(1);
    return row ? toResume(row) : null;
  }
  async delete(userId: string, id: string) {
    if (!validId(id) || !validId(userId)) return false;
    const rows = await this.db.delete(resumes).where(and(eq(resumes.id, id), eq(resumes.userId, userId))).returning({ id: resumes.id });
    return rows.length > 0;
  }
}

class PgProfileRepo implements ProfileRepo {
  constructor(private db: Db) {}
  async get(userId: string) {
    if (!validId(userId)) return null;
    const [row] = await this.db.select().from(candidateProfiles).where(eq(candidateProfiles.userId, userId));
    return row ? { ...row, profile: parseProfile(row.profile) } : null;
  }
  async save(userId: string, profile: CandidateProfile, opts: { expectedVersion?: number; resumeId?: string | null } = {}) {
    if (!validId(userId)) throw new RepoError("Invalid user id.", "not_found");
    const valid = parseProfile(profile);
    const resumeSet = opts.resumeId !== undefined ? { resumeId: opts.resumeId } : {};
    if (opts.expectedVersion === 0) {
      // Caller expects no existing row.
      const rows = await this.db
        .insert(candidateProfiles)
        .values({ userId, profile: valid, version: 1, ...resumeSet })
        .onConflictDoNothing()
        .returning();
      if (!rows[0]) throw new RepoError("Profile was changed elsewhere. Reload and try again.", "conflict");
      return { ...rows[0], profile: valid };
    }
    if (opts.expectedVersion !== undefined) {
      const rows = await this.db
        .update(candidateProfiles)
        .set({ profile: valid, version: sql`${candidateProfiles.version} + 1`, updatedAt: new Date(), ...resumeSet })
        .where(and(eq(candidateProfiles.userId, userId), eq(candidateProfiles.version, opts.expectedVersion)))
        .returning();
      if (!rows[0]) throw new RepoError("Profile was changed elsewhere. Reload and try again.", "conflict");
      return { ...rows[0], profile: valid };
    }
    const [row] = await this.db
      .insert(candidateProfiles)
      .values({ userId, profile: valid, version: 1, ...resumeSet })
      .onConflictDoUpdate({
        target: candidateProfiles.userId,
        set: { profile: valid, version: sql`${candidateProfiles.version} + 1`, updatedAt: new Date(), ...resumeSet },
      })
      .returning();
    return { ...row!, profile: valid };
  }
}

class PgApplicationRepo implements ApplicationRepo {
  constructor(private db: Db) {}
  async create(userId: string, input: NewApplication) {
    const [row] = await this.db
      .insert(applications)
      .values({
        userId,
        targetKey: input.targetKey,
        targetUrl: input.targetUrl,
        title: input.title ?? null,
        company: input.company ?? null,
        useLlm: input.useLlm,
        profileSnapshot: parseProfile(input.profileSnapshot),
        resumeId: input.resumeId,
        postingId: input.postingId ?? null,
        status: "draft",
      })
      .returning();
    return toApplication(row!);
  }
  async get(userId: string, id: string) {
    if (!validId(id) || !validId(userId)) return null;
    const [row] = await this.db.select().from(applications).where(and(eq(applications.id, id), eq(applications.userId, userId)));
    return row ? toApplication(row) : null;
  }
  async list(userId: string, opts: { limit?: number } = {}) {
    if (!validId(userId)) return [];
    const rows = await this.db
      .select()
      .from(applications)
      .where(eq(applications.userId, userId))
      .orderBy(desc(applications.createdAt))
      .limit(Math.min(opts.limit ?? 50, 200));
    return rows.map(toApplication);
  }
  async update(userId: string, id: string, patch: ApplicationPatch) {
    const current = await this.get(userId, id);
    if (!current) throw new RepoError("Application not found.", "not_found");
    if (patch.status && patch.status !== current.status && !canTransition(current.status, patch.status)) {
      throw new RepoError(`Cannot move application from ${current.status} to ${patch.status}.`, "invalid_transition");
    }
    const set: Partial<typeof applications.$inferInsert> = { updatedAt: new Date() };
    if (patch.status) set.status = patch.status;
    if (patch.report !== undefined) set.report = patch.report;
    if (patch.error !== undefined) set.error = patch.error;
    if (patch.profileSnapshot) set.profileSnapshot = parseProfile(patch.profileSnapshot);
    if (patch.useLlm !== undefined) set.useLlm = patch.useLlm;
    if (patch.resumeId !== undefined) set.resumeId = patch.resumeId;
    if (patch.status === "submitted_by_user") set.submittedAt = new Date();
    // Compare-and-set on the status we validated against, so concurrent updates cannot skip the state machine.
    const [row] = await this.db
      .update(applications)
      .set(set)
      .where(and(eq(applications.id, id), eq(applications.userId, userId), eq(applications.status, current.status)))
      .returning();
    if (!row) throw new RepoError("Application changed concurrently. Try again.", "conflict");
    return toApplication(row);
  }
}

function toPosting(r: typeof jobPostings.$inferSelect): PostingRecord {
  return { ...r, source: r.source as PostingSource, retrieval: r.retrieval as PostingDraft["retrieval"], match: r.match ?? null, tailoring: r.tailoring ?? null };
}

class PgPostingRepo implements PostingRepo {
  constructor(private db: Db) {}
  async create(userId: string, draft: PostingDraft) {
    if (!validId(userId)) throw new RepoError("Invalid user id.", "not_found");
    const rows = await this.db.insert(jobPostings).values({ ...draft, userId }).onConflictDoNothing().returning();
    if (rows[0]) return { record: toPosting(rows[0]), existed: false };
    const [dup] = await this.db.select().from(jobPostings).where(and(eq(jobPostings.userId, userId), eq(jobPostings.source, draft.source), eq(jobPostings.externalId, draft.externalId ?? "")));
    if (!dup) throw new RepoError("Could not save the posting.", "conflict");
    return { record: toPosting(dup), existed: true };
  }
  async get(userId: string, id: string) {
    if (!validId(id) || !validId(userId)) return null;
    const [r] = await this.db.select().from(jobPostings).where(and(eq(jobPostings.id, id), eq(jobPostings.userId, userId)));
    return r ? toPosting(r) : null;
  }
  async list(userId: string, opts: { limit?: number } = {}) {
    if (!validId(userId)) return [];
    const rows = await this.db.select().from(jobPostings).where(eq(jobPostings.userId, userId)).orderBy(desc(jobPostings.createdAt)).limit(Math.min(opts.limit ?? 50, 200));
    return rows.map(toPosting);
  }
  async update(userId: string, id: string, patch: PostingPatch) {
    if (!validId(id) || !validId(userId)) throw new RepoError("Job posting not found.", "not_found");
    const [r] = await this.db.update(jobPostings).set({ ...patch, updatedAt: new Date() }).where(and(eq(jobPostings.id, id), eq(jobPostings.userId, userId))).returning();
    if (!r) throw new RepoError("Job posting not found.", "not_found");
    return toPosting(r);
  }
  async delete(userId: string, id: string) {
    if (!validId(id) || !validId(userId)) return false;
    const rows = await this.db.delete(jobPostings).where(and(eq(jobPostings.id, id), eq(jobPostings.userId, userId))).returning({ id: jobPostings.id });
    return rows.length > 0;
  }
}

export function createPostgresRepos(db: Db): Repos {
  return { driver: "postgres", resumes: new PgResumeRepo(db), profiles: new PgProfileRepo(db), applications: new PgApplicationRepo(db), postings: new PgPostingRepo(db) };
}
