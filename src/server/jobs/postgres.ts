/**
 * Postgres job queue. Each state change is ONE SQL statement (data-modifying
 * CTEs), so job and application rows always move together without relying on
 * multi-statement transactions, and concurrent workers never claim the same
 * job (FOR UPDATE SKIP LOCKED).
 */
import { sql, type SQL } from "drizzle-orm";

import type { AutofillReport } from "~/server/apply/run";
import type { Db } from "~/server/repos/postgres";
import { JobError, sanitizeLog, type JobLogEntry, type JobQueue, type JobRecord } from "./types";

const J = sql.raw(`"aura-farmer_apply_job"`);
const A = sql.raw(`"aura-farmer_application"`);
const L = sql.raw(`"aura-farmer_apply_job_log"`);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = Record<string, unknown>;

async function rows(db: Db, q: SQL): Promise<Row[]> {
  const res: unknown = await db.execute(q);
  // postgres-js returns an array; PGlite returns { rows }.
  if (Array.isArray(res)) return res as Row[];
  return (res as { rows?: Row[] }).rows ?? [];
}

const date = (v: unknown) => (v == null ? null : v instanceof Date ? v : new Date(v as string | number));

function toJob(r: Row): JobRecord {
  return {
    id: String(r.id),
    applicationId: String(r.application_id),
    userId: String(r.user_id),
    status: r.status as JobRecord["status"],
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    runAfter: date(r.run_after)!,
    leaseExpiresAt: date(r.lease_expires_at),
    workerId: (r.worker_id as string | null) ?? null,
    cancelRequested: Boolean(r.cancel_requested),
    lastError: (r.last_error as string | null) ?? null,
    createdAt: date(r.created_at)!,
    updatedAt: date(r.updated_at)!,
  };
}

const ms = (n: number) => sql`(${String(Math.max(0, Math.round(n)))} || ' milliseconds')::interval`;

export class PostgresJobQueue implements JobQueue {
  readonly driver = "postgres" as const;
  constructor(private readonly db: Db) {}

  async enqueue(userId: string, applicationId: string, opts: { maxAttempts?: number } = {}) {
    if (!UUID_RE.test(userId) || !UUID_RE.test(applicationId)) throw new JobError("Application not found.", "not_found");
    let r: Row[];
    try {
      r = await rows(
        this.db,
        sql`with app as (
              update ${A} set status = 'queued', error = null, updated_at = now()
              where id = ${applicationId} and user_id = ${userId}
                and status in ('draft', 'ready_for_review', 'failed', 'cancelled')
              returning id
            ), job as (
              insert into ${J} (application_id, user_id, max_attempts)
              select id, ${userId}, ${opts.maxAttempts ?? 2} from app
              returning id
            ), lg as (
              insert into ${L} (job_id, level, message) select id, 'info', 'Queued.' from job
            )
            select id from job`,
      );
    } catch (e) {
      if (/apply_job_one_active_idx|unique/i.test(String((e as Error)?.message))) throw new JobError("A run is already queued or running.", "already_active");
      throw e;
    }
    if (!r[0]) {
      const exists = await rows(this.db, sql`select status from ${A} where id = ${applicationId} and user_id = ${userId}`);
      if (!exists[0]) throw new JobError("Application not found.", "not_found");
      throw new JobError("A run is already queued or running.", "already_active");
    }
    return { jobId: String(r[0].id) };
  }

  async cancel(userId: string, applicationId: string) {
    if (!UUID_RE.test(userId) || !UUID_RE.test(applicationId)) return false;
    const r = await rows(
      this.db,
      sql`with j as (
            update ${J} set
              status = case when status = 'queued' then 'cancelled' else status end,
              cancel_requested = true, updated_at = now()
            where application_id = ${applicationId} and user_id = ${userId} and status in ('queued', 'running')
            returning id, status
          ), a as (
            update ${A} set status = 'cancelled', updated_at = now()
            where id = ${applicationId} and user_id = ${userId} and exists (select 1 from j where status = 'cancelled')
          ), lg as (
            insert into ${L} (job_id, level, message)
            select id, 'info', case when status = 'cancelled' then 'Cancelled before start.' else 'Cancellation requested.' end from j
          )
          select id from j`,
    );
    return r.length > 0;
  }

  async claim(workerId: string, leaseMs: number) {
    // Fail crashed jobs that are out of attempts.
    await rows(
      this.db,
      sql`with dead as (
            update ${J} set status = 'failed', last_error = 'Worker stopped responding.', updated_at = now()
            where status = 'running' and lease_expires_at < now() and attempts >= max_attempts
            returning application_id, user_id
          )
          update ${A} a set status = 'failed', error = 'The browser worker stopped responding.', updated_at = now()
          from dead where a.id = dead.application_id and a.user_id = dead.user_id`,
    );
    const r = await rows(
      this.db,
      sql`with pick as (
            select id, status as prev from ${J}
            where (status = 'queued' and run_after <= now())
               or (status = 'running' and lease_expires_at < now() and attempts < max_attempts)
            order by run_after
            limit 1
            for update skip locked
          ), j as (
            update ${J} t set status = 'running', attempts = t.attempts + 1, worker_id = ${workerId},
              lease_expires_at = now() + ${ms(leaseMs)}, updated_at = now()
            from pick where t.id = pick.id
            returning t.*, pick.prev
          ), a as (
            update ${A} a set status = 'running', updated_at = now()
            from j where a.id = j.application_id and a.user_id = j.user_id and a.status <> 'running'
          ), lg as (
            insert into ${L} (job_id, level, message)
            select id, case when prev = 'running' then 'warn' else 'info' end,
              case when prev = 'running' then 'Recovered after an expired lease; attempt ' || attempts
                   else 'Started by worker (attempt ' || attempts || ').' end
            from j
          )
          select * from j`,
    );
    return r[0] ? toJob(r[0]) : null;
  }

  async heartbeat(jobId: string, workerId: string, leaseMs: number) {
    const r = await rows(
      this.db,
      sql`update ${J} set lease_expires_at = now() + ${ms(leaseMs)}, updated_at = now()
          where id = ${jobId} and worker_id = ${workerId} and status = 'running'
          returning cancel_requested`,
    );
    if (!r[0]) throw new JobError("Lease lost.", "lease_lost");
    return { cancelRequested: Boolean(r[0].cancel_requested) };
  }

  async complete(jobId: string, workerId: string, report: AutofillReport) {
    const r = await rows(
      this.db,
      sql`with j as (
            update ${J} set status = 'succeeded', lease_expires_at = null, updated_at = now()
            where id = ${jobId} and worker_id = ${workerId} and status = 'running'
            returning application_id, user_id
          )
          update ${A} a set status = 'ready_for_review', report = ${JSON.stringify(report)}::jsonb, error = null, updated_at = now()
          from j where a.id = j.application_id and a.user_id = j.user_id
          returning a.id`,
    );
    if (!r[0]) throw new JobError("Lease lost.", "lease_lost");
  }

  async fail(jobId: string, workerId: string, error: string, opts: { retryable: boolean; backoffMs?: number }) {
    const msg = sanitizeLog(error);
    const r = await rows(
      this.db,
      sql`with j as (
            update ${J} set
              status = case when ${opts.retryable} and attempts < max_attempts then 'queued' else 'failed' end,
              run_after = case when ${opts.retryable} and attempts < max_attempts then now() + ${ms(opts.backoffMs ?? 2000)} else run_after end,
              worker_id = case when ${opts.retryable} and attempts < max_attempts then null else worker_id end,
              last_error = ${msg}, lease_expires_at = null, updated_at = now()
            where id = ${jobId} and worker_id = ${workerId} and status = 'running'
            returning application_id, user_id, status
          )
          update ${A} a set status = j.status, error = case when j.status = 'failed' then ${msg} else null end, updated_at = now()
          from j where a.id = j.application_id and a.user_id = j.user_id
          returning j.status`,
    );
    if (!r[0]) throw new JobError("Lease lost.", "lease_lost");
    return { willRetry: r[0].status === "queued" };
  }

  async acknowledgeCancel(jobId: string, workerId: string) {
    const r = await rows(
      this.db,
      sql`with j as (
            update ${J} set status = 'cancelled', lease_expires_at = null, updated_at = now()
            where id = ${jobId} and worker_id = ${workerId} and status = 'running'
            returning application_id, user_id
          )
          update ${A} a set status = 'cancelled', updated_at = now()
          from j where a.id = j.application_id and a.user_id = j.user_id
          returning a.id`,
    );
    if (!r[0]) throw new JobError("Lease lost.", "lease_lost");
  }

  async log(jobId: string, level: JobLogEntry["level"], message: string) {
    await rows(this.db, sql`insert into ${L} (job_id, level, message) values (${jobId}, ${level}, ${sanitizeLog(message)})`);
  }

  async latest(userId: string, applicationId: string) {
    if (!UUID_RE.test(userId) || !UUID_RE.test(applicationId)) return null;
    const j = await rows(this.db, sql`select * from ${J} where application_id = ${applicationId} and user_id = ${userId} order by created_at desc limit 1`);
    if (!j[0]) return null;
    const job = toJob(j[0]);
    const logs = await rows(this.db, sql`select at, level, message from ${L} where job_id = ${job.id} order by id asc limit 500`);
    return { job, logs: logs.map((l) => ({ at: date(l.at)!, level: l.level as JobLogEntry["level"], message: String(l.message) })) };
  }
}
