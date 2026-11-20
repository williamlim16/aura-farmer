/**
 * Browser job queue. One job = one autofill run for one application.
 *
 * Lifecycle: queued -> running -> succeeded | failed | cancelled
 *   - claim() leases a job to a worker for `leaseMs`; the worker heartbeats.
 *   - A job whose lease expires (worker crashed) is re-claimed, counting an
 *     attempt; once attempts reach maxAttempts it is failed instead.
 *   - fail(retryable) re-queues with backoff while attempts remain.
 *   - cancel() removes a queued job immediately or flags a running one; the
 *     worker sees the flag on its next heartbeat and stops.
 * Every queue operation also moves the application's status, so the UI only
 * needs to read the application.
 */
import type { AutofillReport } from "~/server/apply/run";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface JobRecord {
  id: string;
  applicationId: string;
  userId: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  leaseExpiresAt: Date | null;
  workerId: string | null;
  cancelRequested: boolean;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobLogEntry {
  at: Date;
  level: "info" | "warn" | "error";
  message: string;
}

export class JobError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "already_active" | "lease_lost" | "user_limit",
  ) {
    super(message);
    this.name = "JobError";
  }
}

export interface JobQueue {
  readonly driver: "memory" | "postgres";
  /** `maxActivePerUser` is enforced atomically with the insert (no check-then-act race). */
  enqueue(userId: string, applicationId: string, opts?: { maxAttempts?: number; maxActivePerUser?: number }): Promise<{ jobId: string }>;
  cancel(userId: string, applicationId: string): Promise<boolean>;
  claim(workerId: string, leaseMs: number): Promise<JobRecord | null>;
  /** Extends the lease. Throws lease_lost if another worker took over. */
  heartbeat(jobId: string, workerId: string, leaseMs: number): Promise<{ cancelRequested: boolean }>;
  complete(jobId: string, workerId: string, report: AutofillReport): Promise<void>;
  fail(jobId: string, workerId: string, error: string, opts: { retryable: boolean; backoffMs?: number }): Promise<{ willRetry: boolean }>;
  acknowledgeCancel(jobId: string, workerId: string): Promise<void>;
  log(jobId: string, level: JobLogEntry["level"], message: string): Promise<void>;
  /** Logs and job state for the user's application (ownership enforced). */
  latest(userId: string, applicationId: string): Promise<{ job: JobRecord; logs: JobLogEntry[] } | null>;
}

export const MAX_LOG_MESSAGE = 500;
export const sanitizeLog = (m: string) => m.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, MAX_LOG_MESSAGE);
