/**
 * Browser worker end to end: API handlers enqueue, the worker (separate from
 * any request handler) claims and runs jobs in real Chromium against the
 * loopback form host. Memory repos/queue/storage; no network, no real LLM.
 */
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApplicationHandler, ingestHandler, putProfileHandler, type ApiDeps } from "~/server/api/handlers";
import { startFormHost, type FormHost } from "~/server/jobs/form-host";
import { MemoryJobQueue } from "~/server/jobs/memory";
import { BrowserWorker, screenshotKey } from "~/server/jobs/worker";
import { createMemoryRepos } from "~/server/repos/memory";
import { MemoryStorage } from "~/server/storage/memory";
import { fileFrom, makePdf } from "../helpers/resume-fixtures";

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const BOB = "bbbbbbbb-0000-4000-8000-000000000002";

let browser: Browser;
let host: FormHost;
beforeAll(async () => {
  [browser, host] = await Promise.all([chromium.launch({ headless: true }), startFormHost()]);
});
afterAll(async () => {
  await browser?.close();
  await host?.close();
});

let deps: ApiDeps & { queue: MemoryJobQueue; storage: MemoryStorage };
beforeEach(() => {
  const repos = createMemoryRepos();
  deps = { repos, storage: new MemoryStorage(), queue: new MemoryJobQueue(repos) };
});

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
const worker = (o: Partial<ConstructorParameters<typeof BrowserWorker>[0]> = {}) =>
  new BrowserWorker({ queue: deps.queue, repos: deps.repos, storage: deps.storage, formHost: host, launchBrowser: async () => browser, logger: quiet, heartbeatMs: 50, ...o });

async function setupUser(user: string, firstName?: string) {
  await ingestHandler(user, fileFrom(await makePdf(), "cv.pdf"), deps);
  await putProfileHandler(user, { expectedVersion: 1, ...(firstName ? { contact: { firstName } } : {}), preferences: { workAuthCountry: "Australia", workAuthorized: "yes", needsSponsorship: "no" } }, deps);
}
async function createApp(user: string, targetKey = "full-application") {
  const r = await createApplicationHandler(user, { targetKey }, deps);
  return (r.body as { application: { id: string } }).application.id;
}
const app = (user: string, id: string) => deps.repos.applications.get(user, id);
const logs = async (user: string, id: string) => (await deps.queue.latest(user, id))!.logs.map((l) => l.message).join("\n");

describe("BrowserWorker", () => {
  it("runs a queued application to ready_for_review with report, screenshot and logs", async () => {
    await setupUser(ALICE);
    const id = await createApp(ALICE);
    expect(await worker().runOnce()).toBe(true);
    const a = await app(ALICE, id);
    expect(a!.status).toBe("ready_for_review");
    expect(a!.report!.stoppedBeforeSubmit).toBe(true);
    expect(a!.report!.fields.find((f) => f.kind === "work_authorization")).toMatchObject({ outcome: "verified", value: "Yes" });
    expect(a!.report!.fields.find((f) => f.kind === "resume")).toMatchObject({ outcome: "verified" });
    expect((await deps.storage.get(screenshotKey(ALICE, id)))!.byteLength).toBeGreaterThan(1000);
    expect(await logs(ALICE, id)).toMatch(/Ready for your review. Nothing was submitted./);
    expect(host.submissions()).toBe(0);
  });

  it("keeps users isolated: each job uses only its owner's profile", async () => {
    await setupUser(ALICE);
    await setupUser(BOB, "Blake");
    const a = await createApp(ALICE, "basic");
    const b = await createApp(BOB, "basic");
    const w = worker();
    await w.runOnce();
    await w.runOnce();
    const first = (user: string, id: string) => app(user, id).then((x) => x!.report!.fields.find((f) => f.kind === "first_name")!.value);
    expect(await first(ALICE, a)).toBe("Avery");
    expect(await first(BOB, b)).toBe("Blake");
    expect(await deps.storage.get(screenshotKey(BOB, a))).toBeNull();
  });

  it("cancels a running job when the user asks", async () => {
    await setupUser(ALICE);
    const id = await createApp(ALICE, "dynamic"); // multi-round, takes ~1s
    const run = worker().runOnce();
    await new Promise((r) => setTimeout(r, 250));
    expect(await deps.queue.cancel(ALICE, id)).toBe(true);
    await run;
    expect((await app(ALICE, id))!.status).toBe("cancelled");
    expect(await logs(ALICE, id)).toMatch(/Cancelled by user/);
  });

  it("enforces the per-job timeout", async () => {
    await setupUser(ALICE);
    const a = await deps.repos.applications.create(ALICE, { targetKey: "dynamic", targetUrl: "test-form:dynamic.html", useLlm: false, profileSnapshot: (await deps.repos.profiles.get(ALICE))!.profile, resumeId: null });
    await deps.queue.enqueue(ALICE, a.id, { maxAttempts: 1 });
    await worker({ jobTimeoutMs: 200 }).runOnce();
    expect(await app(ALICE, a.id)).toMatchObject({ status: "failed", error: "The autofill run timed out." });
    expect(await logs(ALICE, a.id)).toMatch(/Timed out/);
  });

  it("retries transient browser failures, then succeeds", async () => {
    await setupUser(ALICE);
    const id = await createApp(ALICE, "basic");
    let launches = 0;
    const flaky = worker({ launchBrowser: async () => { if (launches++ === 0) throw new Error("browser failed to launch"); return browser; } });
    await flaky.runOnce();
    expect((await app(ALICE, id))!.status).toBe("queued");
    expect(await logs(ALICE, id)).toMatch(/Will retry/);
    // Skip the backoff for the test.
    const job = (await deps.queue.latest(ALICE, id))!.job;
    (deps.queue as unknown as { jobs: Map<string, { runAfter: Date }> }).jobs.get(job.id)!.runAfter = new Date(0);
    await flaky.runOnce();
    expect((await app(ALICE, id))!.status).toBe("ready_for_review");
  });

  it("fails immediately (no retry) for a target that is not allow-listed", async () => {
    await setupUser(ALICE);
    const a = await deps.repos.applications.create(ALICE, { targetKey: "https://real-site.example", targetUrl: "x", useLlm: false, profileSnapshot: (await deps.repos.profiles.get(ALICE))!.profile, resumeId: null });
    await deps.queue.enqueue(ALICE, a.id, { maxAttempts: 3 });
    await worker().runOnce();
    expect((await app(ALICE, a.id))!.status).toBe("failed");
    expect((await deps.queue.latest(ALICE, a.id))!.job.attempts).toBe(1);
  });

  it("start/stop loop processes queued work and stops gracefully", async () => {
    await setupUser(ALICE);
    const id = await createApp(ALICE, "basic");
    const w = worker({ pollMs: 20 });
    w.start();
    for (let i = 0; i < 100 && (await app(ALICE, id))!.status !== "ready_for_review"; i++) await new Promise((r) => setTimeout(r, 50));
    await w.stop();
    expect((await app(ALICE, id))!.status).toBe("ready_for_review");
  });
});
