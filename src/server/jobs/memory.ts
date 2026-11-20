/** In-process job queue for tests and single-process development. */
import type { AutofillReport } from "~/server/apply/run";
import type { Repos } from "~/server/repos/types";
import { JobError, sanitizeLog, type JobLogEntry, type JobQueue, type JobRecord } from "./types";

export class MemoryJobQueue implements JobQueue {
  readonly driver = "memory" as const;
  private jobs = new Map<string, JobRecord>();
  private logs = new Map<string, JobLogEntry[]>();

  constructor(
    private readonly repos: Repos,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private active(applicationId: string) {
    return [...this.jobs.values()].find((j) => j.applicationId === applicationId && (j.status === "queued" || j.status === "running"));
  }

  private owned(jobId: string, workerId: string) {
    const j = this.jobs.get(jobId);
    if (j?.status !== "running" || j.workerId !== workerId) throw new JobError("Lease lost.", "lease_lost");
    return j;
  }

  async enqueue(userId: string, applicationId: string, opts: { maxAttempts?: number } = {}) {
    const app = await this.repos.applications.get(userId, applicationId);
    if (!app) throw new JobError("Application not found.", "not_found");
    if (this.active(applicationId)) throw new JobError("A run is already queued or running.", "already_active");
    await this.repos.applications.update(userId, applicationId, { status: "queued", error: null });
    const now = this.now();
    const job: JobRecord = {
      id: crypto.randomUUID(),
      applicationId,
      userId,
      status: "queued",
      attempts: 0,
      maxAttempts: opts.maxAttempts ?? 2,
      runAfter: now,
      leaseExpiresAt: null,
      workerId: null,
      cancelRequested: false,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    await this.log(job.id, "info", "Queued.");
    return { jobId: job.id };
  }

  async cancel(userId: string, applicationId: string) {
    const j = this.active(applicationId);
    if (j?.userId !== userId) return false;
    if (j.status === "queued") {
      Object.assign(j, { status: "cancelled", updatedAt: this.now() });
      await this.repos.applications.update(userId, applicationId, { status: "cancelled" });
      await this.log(j.id, "info", "Cancelled before start.");
    } else {
      j.cancelRequested = true;
      await this.log(j.id, "info", "Cancellation requested.");
    }
    return true;
  }

  async claim(workerId: string, leaseMs: number) {
    const now = this.now();
    // Crashed workers: expired leases with no attempts left are failed.
    for (const j of this.jobs.values()) {
      if (j.status === "running" && j.leaseExpiresAt && j.leaseExpiresAt < now && j.attempts >= j.maxAttempts) {
        Object.assign(j, { status: "failed", lastError: "Worker stopped responding.", updatedAt: now });
        await this.repos.applications.update(j.userId, j.applicationId, { status: "failed", error: "The browser worker stopped responding." }).catch(() => undefined);
      }
    }
    const candidates = [...this.jobs.values()]
      .filter((j) => (j.status === "queued" && j.runAfter <= now) || (j.status === "running" && j.leaseExpiresAt !== null && j.leaseExpiresAt < now))
      .sort((a, b) => a.runAfter.getTime() - b.runAfter.getTime());
    const j = candidates[0];
    if (!j) return null;
    const recovered = j.status === "running";
    Object.assign(j, { status: "running", attempts: j.attempts + 1, workerId, leaseExpiresAt: new Date(now.getTime() + leaseMs), updatedAt: now });
    const app = await this.repos.applications.get(j.userId, j.applicationId);
    if (app && app.status !== "running") await this.repos.applications.update(j.userId, j.applicationId, { status: "running" });
    await this.log(j.id, recovered ? "warn" : "info", recovered ? `Recovered after an expired lease; attempt ${j.attempts}.` : `Started by worker (attempt ${j.attempts}).`);
    return structuredClone(j);
  }

  async heartbeat(jobId: string, workerId: string, leaseMs: number) {
    const j = this.owned(jobId, workerId);
    j.leaseExpiresAt = new Date(this.now().getTime() + leaseMs);
    return { cancelRequested: j.cancelRequested };
  }

  async complete(jobId: string, workerId: string, report: AutofillReport) {
    const j = this.owned(jobId, workerId);
    Object.assign(j, { status: "succeeded", leaseExpiresAt: null, updatedAt: this.now() });
    await this.repos.applications.update(j.userId, j.applicationId, { status: "ready_for_review", report, error: null });
  }

  async fail(jobId: string, workerId: string, error: string, opts: { retryable: boolean; backoffMs?: number }) {
    const j = this.owned(jobId, workerId);
    const msg = sanitizeLog(error);
    const willRetry = opts.retryable && j.attempts < j.maxAttempts;
    if (willRetry) {
      Object.assign(j, { status: "queued", lastError: msg, leaseExpiresAt: null, workerId: null, runAfter: new Date(this.now().getTime() + (opts.backoffMs ?? 2000)), updatedAt: this.now() });
      await this.repos.applications.update(j.userId, j.applicationId, { status: "queued", error: null });
    } else {
      Object.assign(j, { status: "failed", lastError: msg, leaseExpiresAt: null, updatedAt: this.now() });
      await this.repos.applications.update(j.userId, j.applicationId, { status: "failed", error: msg });
    }
    return { willRetry };
  }

  async acknowledgeCancel(jobId: string, workerId: string) {
    const j = this.owned(jobId, workerId);
    Object.assign(j, { status: "cancelled", leaseExpiresAt: null, updatedAt: this.now() });
    await this.repos.applications.update(j.userId, j.applicationId, { status: "cancelled" });
  }

  async log(jobId: string, level: JobLogEntry["level"], message: string) {
    const list = this.logs.get(jobId) ?? [];
    list.push({ at: this.now(), level, message: sanitizeLog(message) });
    if (list.length > 500) list.shift();
    this.logs.set(jobId, list);
  }

  async latest(userId: string, applicationId: string) {
    const jobs = [...this.jobs.values()].filter((j) => j.applicationId === applicationId && j.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const job = jobs[0];
    if (!job) return null;
    return { job: structuredClone(job), logs: structuredClone(this.logs.get(job.id) ?? []) };
  }
}
