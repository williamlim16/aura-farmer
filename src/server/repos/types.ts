/**
 * Persistence interfaces for the apply workflow. Every method is scoped by
 * userId: a record owned by someone else behaves exactly like a missing one
 * (null / not_found), so ids cannot be probed across users.
 */
import type { ApplicationStatus } from "~/lib/applications/status";
import type { PostingDraft, PostingRequirements, PostingSource } from "~/lib/postings/types";
import type { CandidateProfile } from "~/lib/profile/schema";
import type { ResumeKind } from "~/lib/resume/validate";
import type { AutofillReport } from "~/server/apply/run";

export interface ResumeRecord {
  id: string;
  userId: string;
  storageKey: string;
  kind: ResumeKind;
  filename: string;
  sizeBytes: number;
  createdAt: Date;
}

export interface ProfileRecord {
  userId: string;
  profile: CandidateProfile;
  resumeId: string | null;
  version: number;
  updatedAt: Date;
}

export interface ApplicationRecord {
  id: string;
  userId: string;
  targetKey: string;
  targetUrl: string;
  title: string | null;
  company: string | null;
  status: ApplicationStatus;
  useLlm: boolean;
  profileSnapshot: CandidateProfile;
  resumeId: string | null;
  postingId: string | null;
  report: AutofillReport | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  submittedAt: Date | null;
}

export class RepoError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "conflict" | "invalid_transition" | "config",
  ) {
    super(message);
    this.name = "RepoError";
  }
}

export interface ResumeRepo {
  create(userId: string, input: Omit<ResumeRecord, "id" | "userId" | "createdAt">): Promise<ResumeRecord>;
  get(userId: string, id: string): Promise<ResumeRecord | null>;
  latest(userId: string): Promise<ResumeRecord | null>;
  delete(userId: string, id: string): Promise<boolean>;
}

export interface ProfileRepo {
  get(userId: string): Promise<ProfileRecord | null>;
  /**
   * Insert or update. With `expectedVersion`, fails with "conflict" if the
   * stored version differs (another tab saved first). Returns the new record.
   */
  save(userId: string, profile: CandidateProfile, opts?: { expectedVersion?: number; resumeId?: string | null }): Promise<ProfileRecord>;
}

export interface NewApplication {
  targetKey: string;
  targetUrl: string;
  title?: string | null;
  company?: string | null;
  useLlm: boolean;
  profileSnapshot: CandidateProfile;
  resumeId: string | null;
  postingId?: string | null;
}

export interface ApplicationPatch {
  status?: ApplicationStatus;
  report?: AutofillReport | null;
  error?: string | null;
  profileSnapshot?: CandidateProfile;
  useLlm?: boolean;
  resumeId?: string | null;
}

export interface ApplicationRepo {
  create(userId: string, input: NewApplication): Promise<ApplicationRecord>;
  get(userId: string, id: string): Promise<ApplicationRecord | null>;
  list(userId: string, opts?: { limit?: number }): Promise<ApplicationRecord[]>;
  /** Applies a status transition only if allowed from the current status. */
  update(userId: string, id: string, patch: ApplicationPatch): Promise<ApplicationRecord>;
}

export interface PostingRecord {
  id: string;
  userId: string;
  source: PostingSource;
  sourceUrl: string | null;
  externalId: string | null;
  title: string;
  company: string;
  location: string;
  description: string;
  requirements: PostingRequirements;
  retrieval: PostingDraft["retrieval"];
  match: unknown;
  tailoring: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface PostingPatch {
  title?: string;
  company?: string;
  location?: string;
  description?: string;
  requirements?: PostingRequirements;
  match?: unknown;
  tailoring?: unknown;
}

export interface PostingRepo {
  /** Saves a posting; an already-saved import (same source + external id) is returned instead of duplicated. */
  create(userId: string, draft: PostingDraft): Promise<{ record: PostingRecord; existed: boolean }>;
  get(userId: string, id: string): Promise<PostingRecord | null>;
  list(userId: string, opts?: { limit?: number }): Promise<PostingRecord[]>;
  update(userId: string, id: string, patch: PostingPatch): Promise<PostingRecord>;
  delete(userId: string, id: string): Promise<boolean>;
}

export interface Repos {
  readonly driver: "memory" | "postgres";
  postings: PostingRepo;
  resumes: ResumeRepo;
  profiles: ProfileRepo;
  applications: ApplicationRepo;
}
