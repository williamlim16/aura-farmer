/**
 * In-memory repositories for tests and local development. Data lives only as
 * long as the process; getRepos() refuses this driver in production.
 */
import { canTransition, InvalidTransitionError } from "~/lib/applications/status";
import type { PostingDraft } from "~/lib/postings/types";
import type { CandidateProfile } from "~/lib/profile/schema";
import {
  RepoError,
  type ApplicationPatch,
  type ApplicationRecord,
  type ApplicationRepo,
  type NewApplication,
  type PostingPatch,
  type PostingRecord,
  type PostingRepo,
  type ProfileRecord,
  type ProfileRepo,
  type Repos,
  type ResumeRecord,
  type ResumeRepo,
} from "./types";

// Callers must not be able to mutate stored state through returned objects.
const clone = <T>(v: T): T => structuredClone(v);

class MemoryResumeRepo implements ResumeRepo {
  private rows = new Map<string, ResumeRecord>();
  async create(userId: string, input: Omit<ResumeRecord, "id" | "userId" | "createdAt">) {
    const row: ResumeRecord = { ...input, id: crypto.randomUUID(), userId, createdAt: new Date() };
    this.rows.set(row.id, row);
    return clone(row);
  }
  async get(userId: string, id: string) {
    const r = this.rows.get(id);
    return r?.userId === userId ? clone(r) : null;
  }
  async latest(userId: string) {
    const mine = [...this.rows.values()].filter((r) => r.userId === userId);
    mine.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return mine[0] ? clone(mine[0]) : null;
  }
  async delete(userId: string, id: string) {
    const r = this.rows.get(id);
    if (r?.userId !== userId) return false;
    return this.rows.delete(id);
  }
}

class MemoryProfileRepo implements ProfileRepo {
  private rows = new Map<string, ProfileRecord>();
  async get(userId: string) {
    const r = this.rows.get(userId);
    return r ? clone(r) : null;
  }
  async save(userId: string, profile: CandidateProfile, opts: { expectedVersion?: number; resumeId?: string | null } = {}) {
    const cur = this.rows.get(userId);
    if (opts.expectedVersion !== undefined && (cur?.version ?? 0) !== opts.expectedVersion) {
      throw new RepoError("Profile was changed elsewhere. Reload and try again.", "conflict");
    }
    const row: ProfileRecord = {
      userId,
      profile: clone(profile),
      resumeId: opts.resumeId !== undefined ? opts.resumeId : (cur?.resumeId ?? null),
      version: (cur?.version ?? 0) + 1,
      updatedAt: new Date(),
    };
    this.rows.set(userId, row);
    return clone(row);
  }
}

class MemoryApplicationRepo implements ApplicationRepo {
  private rows = new Map<string, ApplicationRecord>();
  async create(userId: string, input: NewApplication) {
    const now = new Date();
    const row: ApplicationRecord = {
      id: crypto.randomUUID(),
      userId,
      targetKey: input.targetKey,
      targetUrl: input.targetUrl,
      title: input.title ?? null,
      company: input.company ?? null,
      status: "draft",
      useLlm: input.useLlm,
      profileSnapshot: clone(input.profileSnapshot),
      resumeId: input.resumeId,
      postingId: input.postingId ?? null,
      report: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      submittedAt: null,
    };
    this.rows.set(row.id, row);
    return clone(row);
  }
  async get(userId: string, id: string) {
    const r = this.rows.get(id);
    return r?.userId === userId ? clone(r) : null;
  }
  async list(userId: string, opts: { limit?: number } = {}) {
    return [...this.rows.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, Math.min(opts.limit ?? 50, 200))
      .map(clone);
  }
  async update(userId: string, id: string, patch: ApplicationPatch) {
    const r = this.rows.get(id);
    if (r?.userId !== userId) throw new RepoError("Application not found.", "not_found");
    if (patch.status && patch.status !== r.status && !canTransition(r.status, patch.status)) {
      throw new RepoError(new InvalidTransitionError(r.status, patch.status).message, "invalid_transition");
    }
    const next: ApplicationRecord = {
      ...r,
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.report !== undefined ? { report: clone(patch.report) } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      ...(patch.profileSnapshot ? { profileSnapshot: clone(patch.profileSnapshot) } : {}),
      ...(patch.useLlm !== undefined ? { useLlm: patch.useLlm } : {}),
      ...(patch.resumeId !== undefined ? { resumeId: patch.resumeId } : {}),
      ...(patch.status === "submitted_by_user" ? { submittedAt: new Date() } : {}),
      updatedAt: new Date(),
    };
    this.rows.set(id, next);
    return clone(next);
  }
}

class MemoryPostingRepo implements PostingRepo {
  private rows = new Map<string, PostingRecord>();
  async create(userId: string, draft: PostingDraft) {
    const dup = draft.externalId ? [...this.rows.values()].find((r) => r.userId === userId && r.source === draft.source && r.externalId === draft.externalId) : undefined;
    if (dup) return { record: clone(dup), existed: true };
    const now = new Date();
    const row: PostingRecord = { ...clone(draft), id: crypto.randomUUID(), userId, match: null, tailoring: null, createdAt: now, updatedAt: now };
    this.rows.set(row.id, row);
    return { record: clone(row), existed: false };
  }
  async get(userId: string, id: string) {
    const r = this.rows.get(id);
    return r?.userId === userId ? clone(r) : null;
  }
  async list(userId: string, opts: { limit?: number } = {}) {
    return [...this.rows.values()].filter((r) => r.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, Math.min(opts.limit ?? 50, 200)).map(clone);
  }
  async update(userId: string, id: string, patch: PostingPatch) {
    const r = this.rows.get(id);
    if (r?.userId !== userId) throw new RepoError("Job posting not found.", "not_found");
    const next: PostingRecord = { ...r, ...clone(patch), updatedAt: new Date() };
    this.rows.set(id, next);
    return clone(next);
  }
  async delete(userId: string, id: string) {
    const r = this.rows.get(id);
    if (r?.userId !== userId) return false;
    return this.rows.delete(id);
  }
}

export function createMemoryRepos(): Repos {
  return { driver: "memory", resumes: new MemoryResumeRepo(), profiles: new MemoryProfileRepo(), applications: new MemoryApplicationRepo(), postings: new MemoryPostingRepo() };
}
