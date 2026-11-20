import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { AutofillReport } from "~/server/apply/run";
import { MemoryJobQueue } from "~/server/jobs/memory";
import { PostgresJobQueue } from "~/server/jobs/postgres";
import type { JobQueue } from "~/server/jobs/types";
import { createMemoryRepos } from "~/server/repos/memory";
import { createPostgresRepos } from "~/server/repos/postgres";
import type { Repos } from "~/server/repos/types";
import { syntheticProfile } from "../helpers/apply-harness";
import { createTestDb } from "../helpers/pglite";

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const BOB = "bbbbbbbb-0000-4000-8000-000000000002";
const report = { stoppedBeforeSubmit: true, fields: [], metrics: { verified: 1 }, blockedSubmits: { inPage: 0, network: 0 } } as unknown as AutofillReport;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const c of closers) await c();
});

const impls: [string, () => Promise<{ repos: Repos; queue: JobQueue }>][] = [
  ["memory", async () => { const repos = createMemoryRepos(); return { repos, queue: new MemoryJobQueue(repos) }; }],
  ["postgres (PGlite)", async () => { const t = await createTestDb(); closers.push(t.close); return { repos: createPostgresRepos(t.db), queue: new PostgresJobQueue(t.db) }; }],
];

describe.each(impls)("job queue: %s", (_n, make) => {
  let repos: Repos, queue: JobQueue;
  beforeEach(async () => ({ repos, queue } = await make()));
  const newApp = (user = ALICE) => repos.applications.create(user, { targetKey: "basic", targetUrl: "test-form:basic.html", useLlm: false, profileSnapshot: syntheticProfile(), resumeId: null });

  it("enqueue -> claim -> complete moves the application to ready_for_review", async () => {
    const app = await newApp();
    await queue.enqueue(ALICE, app.id);
    expect((await repos.applications.get(ALICE, app.id))!.status).toBe("queued");
    const job = await queue.claim("w1", 10_000);
    expect(job).toMatchObject({ applicationId: app.id, status: "running", attempts: 1, workerId: "w1" });
    expect((await repos.applications.get(ALICE, app.id))!.status).toBe("running");
    await queue.complete(job!.id, "w1", report);
    const done = await repos.applications.get(ALICE, app.id);
    expect(done).toMatchObject({ status: "ready_for_review" });
    expect(done!.report?.stoppedBeforeSubmit).toBe(true);
    expect(await queue.claim("w1", 10_000)).toBeNull();
    const latest = await queue.latest(ALICE, app.id);
    expect(latest!.job.status).toBe("succeeded");
    expect(latest!.logs.map((l) => l.message)).toEqual(expect.arrayContaining(["Queued.", expect.stringContaining("Started by worker")]));
  });

  it("allows only one active job per application and enforces ownership", async () => {
    const app = await newApp();
    await queue.enqueue(ALICE, app.id);
    await expect(queue.enqueue(ALICE, app.id)).rejects.toMatchObject({ code: "already_active" });
    await expect(queue.enqueue(BOB, app.id)).rejects.toMatchObject({ code: "not_found" });
    expect(await queue.cancel(BOB, app.id)).toBe(false);
    expect(await queue.latest(BOB, app.id)).toBeNull();
  });

  it("two workers never claim the same job", async () => {
    const a = await newApp();
    await queue.enqueue(ALICE, a.id);
    const [j1, j2] = await Promise.all([queue.claim("w1", 10_000), queue.claim("w2", 10_000)]);
    expect([j1, j2].filter(Boolean)).toHaveLength(1);
  });

  it("retryable failure re-queues with backoff, then fails after maxAttempts", async () => {
    const app = await newApp();
    await queue.enqueue(ALICE, app.id, { maxAttempts: 2 });
    const j1 = await queue.claim("w1", 10_000);
    expect(await queue.fail(j1!.id, "w1", "browser crashed", { retryable: true, backoffMs: 30 })).toEqual({ willRetry: true });
    expect((await repos.applications.get(ALICE, app.id))!.status).toBe("queued");
    expect(await queue.claim("w1", 10_000)).toBeNull(); // still backing off
    await sleep(60);
    const j2 = await queue.claim("w1", 10_000);
    expect(j2!.attempts).toBe(2);
    expect(await queue.fail(j2!.id, "w1", "browser crashed again", { retryable: true })).toEqual({ willRetry: false });
    expect(await repos.applications.get(ALICE, app.id)).toMatchObject({ status: "failed", error: "browser crashed again" });
  });

  it("non-retryable failure fails immediately", async () => {
    const app = await newApp();
    await queue.enqueue(ALICE, app.id, { maxAttempts: 3 });
    const j = await queue.claim("w1", 10_000);
    expect(await queue.fail(j!.id, "w1", "no resume", { retryable: false })).toEqual({ willRetry: false });
    expect((await repos.applications.get(ALICE, app.id))!.status).toBe("failed");
  });

  it("recovers a job whose worker died (expired lease), then gives up", async () => {
    const app = await newApp();
    await queue.enqueue(ALICE, app.id, { maxAttempts: 2 });
    const j1 = await queue.claim("dead-worker", 30);
    await sleep(60);
    const j2 = await queue.claim("w2", 30);
    expect(j2).toMatchObject({ id: j1!.id, attempts: 2, workerId: "w2" });
    // The dead worker's late writes are rejected.
    await expect(queue.complete(j1!.id, "dead-worker", report)).rejects.toMatchObject({ code: "lease_lost" });
    await expect(queue.heartbeat(j1!.id, "dead-worker", 1000)).rejects.toMatchObject({ code: "lease_lost" });
    await sleep(60);
    expect(await queue.claim("w3", 1000)).toBeNull(); // out of attempts -> failed
    expect((await repos.applications.get(ALICE, app.id))!.status).toBe("failed");
  });

  it("cancels a queued job immediately and a running job via heartbeat", async () => {
    const a = await newApp();
    await queue.enqueue(ALICE, a.id);
    expect(await queue.cancel(ALICE, a.id)).toBe(true);
    expect((await repos.applications.get(ALICE, a.id))!.status).toBe("cancelled");
    expect(await queue.claim("w1", 10_000)).toBeNull();

    const b = await newApp();
    await queue.enqueue(ALICE, b.id);
    const j = await queue.claim("w1", 10_000);
    expect(await queue.cancel(ALICE, b.id)).toBe(true);
    expect((await queue.heartbeat(j!.id, "w1", 10_000)).cancelRequested).toBe(true);
    await queue.acknowledgeCancel(j!.id, "w1");
    expect((await repos.applications.get(ALICE, b.id))!.status).toBe("cancelled");
    // A cancelled application can be re-run.
    await queue.enqueue(ALICE, b.id);
    expect((await repos.applications.get(ALICE, b.id))!.status).toBe("queued");
  });

  it("sanitises and truncates log messages", async () => {
    const app = await newApp();
    const { jobId } = await queue.enqueue(ALICE, app.id);
    await queue.log(jobId, "warn", `line1\nline2\u0000${"x".repeat(2000)}`);
    const logs = (await queue.latest(ALICE, app.id))!.logs;
    const last = logs.at(-1)!;
    expect(last.message).not.toMatch(/[\n\u0000]/);
    expect(last.message.length).toBeLessThanOrEqual(500);
  });
});
