/**
 * Browser worker: claims jobs from the queue and runs autofill outside any
 * HTTP request. One browser per worker, one fresh browser context per job
 * (no cookies/storage shared between users or jobs).
 *
 * Reliability:
 *  - heartbeat every `heartbeatMs`; a lost lease aborts the run without writing
 *  - cancellation (flag seen on heartbeat) and a hard per-job timeout both
 *    abort the run by closing the context
 *  - only transient failures are retried (browser crash/launch, navigation);
 *    configuration problems fail immediately
 *  - a crashed worker's job is recovered by the queue when its lease expires
 */
import type { Browser } from "playwright";

import { RuleProvider } from "~/lib/apply/decision/rules";
import type { DecisionProvider } from "~/lib/apply/decision/types";
import { findTarget } from "~/lib/applications/targets";
import type { ApplicationRecord, Repos } from "~/server/repos/types";
import type { ObjectStorage } from "~/server/storage/types";
import { runApplication, RunAbortedError } from "~/server/workflow/run-application";
import type { FormHost } from "./form-host";
import { JobError, type JobQueue, type JobRecord } from "./types";

export interface WorkerOptions {
  queue: JobQueue;
  repos: Repos;
  storage: ObjectStorage;
  formHost: FormHost;
  launchBrowser: () => Promise<Browser>;
  workerId?: string;
  leaseMs?: number;
  heartbeatMs?: number;
  jobTimeoutMs?: number;
  pollMs?: number;
  /** Extra decision tiers (e.g. LLM) when an application opted in. Rules always run first. */
  extraProviders?: (app: ApplicationRecord) => DecisionProvider[] | Promise<DecisionProvider[]>;
  /** Selection tier (Jev) used for every application when configured; runs after rules, before any LLM. */
  selectionProviders?: () => DecisionProvider[];
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export const screenshotKey = (userId: string, applicationId: string) => `${userId}/applications/${applicationId}/screenshot.png`;

class NonRetryable extends Error {}

export class BrowserWorker {
  readonly workerId: string;
  private browser: Browser | null = null;
  private running = false;
  private loop: Promise<void> | null = null;
  private readonly o: Required<Omit<WorkerOptions, "extraProviders" | "selectionProviders" | "logger">> & Pick<WorkerOptions, "extraProviders" | "selectionProviders"> & { logger: Pick<Console, "info" | "warn" | "error"> };

  constructor(opts: WorkerOptions) {
    this.workerId = opts.workerId ?? `worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
    this.o = { leaseMs: 30_000, heartbeatMs: 5_000, jobTimeoutMs: 90_000, pollMs: 1_000, logger: console, ...opts, workerId: this.workerId };
  }

  private async getBrowser() {
    if (!this.browser?.isConnected()) this.browser = await this.o.launchBrowser();
    return this.browser;
  }

  /** Process at most one job. Returns true if a job was claimed. */
  async runOnce(): Promise<boolean> {
    const job = await this.o.queue.claim(this.workerId, this.o.leaseMs);
    if (!job) return false;
    await this.execute(job);
    return true;
  }

  private async execute(job: JobRecord) {
    const { queue } = this.o;
    const log = (level: "info" | "warn" | "error", msg: string) => queue.log(job.id, level, msg).catch(() => undefined);
    const ac = new AbortController();
    let leaseLost = false;

    const hb = setInterval(() => {
      queue
        .heartbeat(job.id, this.workerId, this.o.leaseMs)
        .then(({ cancelRequested }) => {
          if (cancelRequested && !ac.signal.aborted) ac.abort("cancelled");
        })
        .catch((e: unknown) => {
          if (e instanceof JobError && e.code === "lease_lost") {
            leaseLost = true;
            ac.abort("lease_lost");
          }
        });
    }, this.o.heartbeatMs);
    const timeout = setTimeout(() => ac.abort("timeout"), this.o.jobTimeoutMs);

    try {
      const app = await this.o.repos.applications.get(job.userId, job.applicationId);
      if (!app) throw new NonRetryable("Application no longer exists.");
      const target = findTarget(app.targetKey);
      if (!target) throw new NonRetryable(`Target "${app.targetKey}" is not allow-listed.`);

      let resume: { bytes: Uint8Array; kind: "pdf" | "docx"; filename: string } | null = null;
      if (app.resumeId) {
        const rec = await this.o.repos.resumes.get(job.userId, app.resumeId);
        const bytes = rec ? await this.o.storage.get(rec.storageKey) : null;
        if (rec && bytes) resume = { bytes, kind: rec.kind, filename: rec.filename };
        else await log("warn", "Resume file not found; resume upload fields will need manual input.");
      }

      const llm = app.useLlm && this.o.extraProviders ? await this.o.extraProviders(app) : [];
      const providers: DecisionProvider[] = [new RuleProvider(), ...(this.o.selectionProviders?.() ?? []), ...llm];
      if (app.useLlm && llm.length === 0) await log("warn", "LLM fallback requested but no LLM provider is configured; using rules only.");
      await log("info", `Opening test form "${target.title}" (${providers.map((p) => p.name).join(" → ")}).`);

      const t0 = Date.now();
      const result = await runApplication({
        formUrl: this.o.formHost.urlFor(target.file),
        profile: app.profileSnapshot,
        resume,
        providers,
        allowedOrigins: [this.o.formHost.origin],
        job: { title: app.title ?? undefined, company: app.company ?? undefined },
        browser: await this.getBrowser(),
        signal: ac.signal,
        onEvent: (level, m) => void log(level, m),
      });

      const m = result.report.metrics;
      await log("info", `Filled ${m.verified}/${m.fields} fields in ${((Date.now() - t0) / 1000).toFixed(1)}s; ${m.needsHuman} need review; ${m.errors + m.mismatches} problems; ${m.llmCalls} model calls.`);
      const blocked = result.report.blockedSubmits.inPage + result.report.blockedSubmits.network;
      if (blocked) await log("warn", `Blocked ${blocked} submission attempt(s) by the page.`);
      if (result.blockedEgress.length) await log("warn", `Blocked ${result.blockedEgress.length} request(s) to non-allowed origins.`);
      if (this.o.formHost.submissions() > 0) await log("error", "A submission reached the form host. This should never happen; please report it.");

      if (leaseLost) return;
      await queue.complete(job.id, this.workerId, result.report); // throws lease_lost if another worker took over
      // Only the worker that completed the job writes its screenshot.
      await this.o.storage.put(screenshotKey(job.userId, job.applicationId), new Uint8Array(result.screenshotPng), "image/png").catch(() => log("warn", "Could not store the screenshot."));
      await log("info", "Ready for your review. Nothing was submitted.");
    } catch (e) {
      if (leaseLost) {
        this.o.logger.warn(`[worker] lease lost for job ${job.id}; another worker owns it now.`);
        return;
      }
      const reason = e instanceof RunAbortedError ? e.reason : null;
      try {
        if (reason === "cancelled") {
          await log("info", "Cancelled by user.");
          await queue.acknowledgeCancel(job.id, this.workerId);
        } else if (reason === "timeout") {
          await log("error", `Timed out after ${Math.round(this.o.jobTimeoutMs / 1000)}s.`);
          await queue.fail(job.id, this.workerId, "The autofill run timed out.", { retryable: true });
        } else if (e instanceof NonRetryable) {
          await log("error", e.message);
          await queue.fail(job.id, this.workerId, e.message, { retryable: false });
        } else {
          const msg = e instanceof Error ? e.message.split("\n")[0]!.slice(0, 200) : "Unknown error";
          await log("error", `Run failed: ${msg}`);
          const { willRetry } = await queue.fail(job.id, this.workerId, "The browser run failed.", { retryable: true });
          if (willRetry) await log("info", "Will retry shortly.");
          if (this.browser && !this.browser.isConnected()) this.browser = null;
        }
      } catch (inner) {
        this.o.logger.error("[worker] could not record job outcome:", inner instanceof Error ? inner.message : inner);
      }
    } finally {
      clearInterval(hb);
      clearTimeout(timeout);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        let worked = false;
        try {
          worked = await this.runOnce();
        } catch (e) {
          this.o.logger.error("[worker] loop error:", e instanceof Error ? e.message : e);
        }
        if (!worked && this.running) await new Promise((r) => setTimeout(r, this.o.pollMs));
      }
    })();
  }

  /** Graceful stop: finishes the current job, then closes the browser. */
  async stop() {
    this.running = false;
    await this.loop;
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }
}
