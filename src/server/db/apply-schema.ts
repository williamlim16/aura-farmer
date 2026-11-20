/**
 * Tables for the resume -> profile -> application workflow.
 *
 * user_id columns hold Supabase auth user ids (auth.users.id). The foreign key
 * to auth.users and the RLS policies live in supabase/apply-policies.sql,
 * because Drizzle does not manage the Supabase `auth` schema. Every repository
 * query also filters by user_id, since Drizzle connects as the database owner
 * and bypasses RLS.
 */
import { sql } from "drizzle-orm";
import { index, pgTableCreator, uniqueIndex } from "drizzle-orm/pg-core";

import type { AutofillReport } from "~/server/apply/run";
import type { CandidateProfile } from "~/lib/profile/schema";

// Same table prefix as schema.ts (drizzle.config tablesFilter: "aura-farmer_*").
// Defined here rather than imported to avoid a circular import with schema.ts.
const createTable = pgTableCreator((name) => `aura-farmer_${name}`);

export const resumes = createTable(
  "resume",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    userId: d.uuid("user_id").notNull(),
    storageKey: d.text("storage_key").notNull(),
    kind: d.varchar({ length: 8 }).notNull(),
    filename: d.varchar({ length: 255 }).notNull(),
    sizeBytes: d.integer("size_bytes").notNull(),
    createdAt: d.timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  }),
  (t) => [uniqueIndex("resume_storage_key_idx").on(t.storageKey), index("resume_user_idx").on(t.userId, t.createdAt)],
);

export const candidateProfiles = createTable("candidate_profile", (d) => ({
  userId: d.uuid("user_id").primaryKey(),
  profile: d.jsonb().$type<CandidateProfile>().notNull(),
  resumeId: d.uuid("resume_id").references(() => resumes.id, { onDelete: "set null" }),
  /** Optimistic concurrency: incremented on every save. */
  version: d.integer().notNull().default(1),
  updatedAt: d.timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}));

export const applications = createTable(
  "application",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    userId: d.uuid("user_id").notNull(),
    /** Key of an allow-listed target (test form or, later, a vetted ATS URL). */
    targetKey: d.varchar("target_key", { length: 200 }).notNull(),
    targetUrl: d.text("target_url").notNull(),
    title: d.varchar({ length: 300 }),
    company: d.varchar({ length: 300 }),
    status: d.varchar({ length: 32 }).notNull().default("draft"),
    useLlm: d.boolean("use_llm").notNull().default(false),
    /** Profile as reviewed when the run was requested, so results are reproducible. */
    profileSnapshot: d.jsonb("profile_snapshot").$type<CandidateProfile>().notNull(),
    resumeId: d.uuid("resume_id").references(() => resumes.id, { onDelete: "set null" }),
    report: d.jsonb().$type<AutofillReport>(),
    error: d.text(),
    createdAt: d.timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: d.timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    submittedAt: d.timestamp("submitted_at", { withTimezone: true }),
  }),
  (t) => [index("application_user_idx").on(t.userId, t.createdAt)],
);

export const applyJobs = createTable(
  "apply_job",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    applicationId: d.uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
    userId: d.uuid("user_id").notNull(),
    status: d.varchar({ length: 16 }).notNull().default("queued"), // queued | running | succeeded | failed | cancelled
    attempts: d.integer().notNull().default(0),
    maxAttempts: d.integer("max_attempts").notNull().default(2),
    runAfter: d.timestamp("run_after", { withTimezone: true }).defaultNow().notNull(),
    leaseExpiresAt: d.timestamp("lease_expires_at", { withTimezone: true }),
    workerId: d.varchar("worker_id", { length: 100 }),
    cancelRequested: d.boolean("cancel_requested").notNull().default(false),
    lastError: d.text("last_error"),
    createdAt: d.timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: d.timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  }),
  (t) => [
    index("apply_job_claim_idx").on(t.status, t.runAfter),
    index("apply_job_application_idx").on(t.applicationId),
    // At most one active job per application: retries/re-runs cannot race.
    uniqueIndex("apply_job_one_active_idx").on(t.applicationId).where(sql`status in ('queued', 'running')`),
  ],
);

export const applyJobLogs = createTable(
  "apply_job_log",
  (d) => ({
    id: d.bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    jobId: d.uuid("job_id").notNull().references(() => applyJobs.id, { onDelete: "cascade" }),
    at: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
    level: d.varchar({ length: 8 }).notNull(),
    message: d.text().notNull(),
  }),
  (t) => [index("apply_job_log_job_idx").on(t.jobId, t.id)],
);
