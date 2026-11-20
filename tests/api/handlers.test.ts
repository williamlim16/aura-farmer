/**
 * API handlers with two fake users over real repos (memory and PGlite).
 * Covers ownership, validation, concurrency and the application lifecycle.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  applicationActionHandler,
  applicationLogsHandler,
  createApplicationHandler,
  getApplicationHandler,
  getProfileHandler,
  ingestHandler,
  listApplicationsHandler,
  putProfileHandler,
  type ApiDeps,
} from "~/server/api/handlers";
import { MemoryJobQueue } from "~/server/jobs/memory";
import { PostgresJobQueue } from "~/server/jobs/postgres";
import { createMemoryRepos } from "~/server/repos/memory";
import { createPostgresRepos } from "~/server/repos/postgres";
import { FileStorage } from "~/server/storage/file";
import { MemoryStorage } from "~/server/storage/memory";
import { createTestDb } from "../helpers/pglite";
import { fileFrom, makePdf } from "../helpers/resume-fixtures";

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const BOB = "bbbbbbbb-0000-4000-8000-000000000002";

const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const c of closers) await c();
});

const impls: [string, () => Promise<ApiDeps>][] = [
  ["memory", async () => { const repos = createMemoryRepos(); return { repos, storage: new MemoryStorage(), queue: new MemoryJobQueue(repos) }; }],
  ["postgres (PGlite)", async () => { const t = await createTestDb(); closers.push(t.close); return { repos: createPostgresRepos(t.db), storage: new MemoryStorage(), queue: new PostgresJobQueue(t.db) }; }],
];

describe.each(impls)("API handlers: %s", (_n, make) => {
  let deps: ApiDeps;
  beforeEach(async () => {
    deps = await make();
  });

  const upload = async (user: string | null = ALICE) => ingestHandler(user, fileFrom(await makePdf(), "cv.pdf"), deps);

  it("requires a user for every handler", async () => {
    for (const r of [await upload(null), await getProfileHandler(null, deps), await putProfileHandler(null, {}, deps), await createApplicationHandler(null, {}, deps), await listApplicationsHandler(null, deps)]) {
      expect(r.status).toBe(401);
    }
  });

  it("upload -> profile saved and linked to the stored resume", async () => {
    const r = await upload();
    expect(r.status).toBe(201);
    const body = r.body as { resume: { id: string }; version: number; review: { contact: { email: { value: string } } } };
    expect(body.review.contact.email.value).toBe("avery.quinn@example.com");
    const got = (await getProfileHandler(ALICE, deps)).body as { version: number; resume: { id: string } };
    expect(got.resume.id).toBe(body.resume.id);
    expect((await getProfileHandler(BOB, deps)).body).toEqual({ profile: null });
  });

  it("re-uploading keeps user-stated preferences and confirmed contact fields", async () => {
    await upload();
    const v = ((await getProfileHandler(ALICE, deps)).body as { version: number }).version;
    const put = await putProfileHandler(ALICE, { expectedVersion: v, contact: { phone: "+61 400 555 777" }, preferences: { needsSponsorship: "no" } }, deps);
    expect(put.status).toBe(200);
    await upload();
    const review = ((await getProfileHandler(ALICE, deps)).body as { review: { contact: { phone: { value: string; source: string } }; preferences: { needsSponsorship: string } } }).review;
    expect(review.contact.phone).toMatchObject({ value: "+61 400 555 777", source: "user" });
    expect(review.preferences.needsSponsorship).toBe("no");
  });

  it("validates profile updates and detects stale versions", async () => {
    await upload();
    expect((await putProfileHandler(ALICE, { expectedVersion: 1, contact: { email: "bad" } }, deps)).status).toBe(422);
    expect((await putProfileHandler(ALICE, { expectedVersion: 1, unknownField: 1 }, deps)).status).toBe(400);
    expect((await putProfileHandler(ALICE, { contact: {} }, deps)).status).toBe(400); // version required
    expect((await putProfileHandler(ALICE, { expectedVersion: 1, summary: "x".repeat(5000) }, deps)).status).toBe(400);
    expect((await putProfileHandler(ALICE, { expectedVersion: 1, summary: "ok" }, deps)).status).toBe(200);
    expect((await putProfileHandler(ALICE, { expectedVersion: 1, summary: "stale" }, deps)).status).toBe(409);
    expect((await putProfileHandler(BOB, { expectedVersion: 0, summary: "x" }, deps)).status).toBe(409); // no profile
  });

  it("creates and queues an application only for allow-listed targets", async () => {
    expect((await createApplicationHandler(ALICE, { targetKey: "basic" }, deps)).status).toBe(409); // no profile yet
    await upload();
    expect((await createApplicationHandler(ALICE, { targetKey: "https://real-job-site.example/apply" }, deps)).status).toBe(400);
    expect((await createApplicationHandler(ALICE, { targetKey: "basic", extra: true }, deps)).status).toBe(400);
    const r = await createApplicationHandler(ALICE, { targetKey: "full-application", useLlm: false }, deps);
    expect(r.status).toBe(201);
    const app = (r.body as { application: { id: string; status: string } }).application;
    expect(app.status).toBe("queued");
    // Duplicate run requests are refused while one is active.
    expect((await applicationActionHandler(ALICE, app.id, { action: "rerun" }, deps)).status).toBe(409);
    const logs = (await applicationLogsHandler(ALICE, app.id, deps)).body as { job: { status: string }; logs: { message: string }[] };
    expect(logs.job.status).toBe("queued");
  });

  it("isolates applications between users", async () => {
    await upload();
    const app = ((await createApplicationHandler(ALICE, { targetKey: "basic" }, deps)).body as { application: { id: string } }).application;
    expect((await getApplicationHandler(BOB, app.id, deps)).status).toBe(404);
    expect((await applicationActionHandler(BOB, app.id, { action: "cancel" }, deps)).status).toBe(404);
    expect((await applicationLogsHandler(BOB, app.id, deps)).status).toBe(404);
    expect(((await listApplicationsHandler(BOB, deps)).body as { applications: unknown[] }).applications).toEqual([]);
    expect((await getApplicationHandler(ALICE, "not-a-uuid", deps)).status).toBe(404);
  });

  it("never lets the user mark an application submitted before it was filled and reviewed", async () => {
    await upload();
    const app = ((await createApplicationHandler(ALICE, { targetKey: "basic" }, deps)).body as { application: { id: string } }).application;
    expect((await applicationActionHandler(ALICE, app.id, { action: "mark_submitted" }, deps)).status).toBe(409);
    expect((await applicationActionHandler(ALICE, app.id, { action: "cancel" }, deps)).status).toBe(200);
    expect(((await getApplicationHandler(ALICE, app.id, deps)).body as { application: { status: string } }).application.status).toBe("cancelled");
  });
});

describe("FileStorage", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "af-fs-"));
  const s = new FileStorage(dir);
  it("round-trips objects", async () => {
    await s.put("u1/resumes/a.pdf", new Uint8Array([1, 2, 3]), "application/pdf");
    expect(Array.from((await s.get("u1/resumes/a.pdf"))!)).toEqual([1, 2, 3]);
    await s.delete("u1/resumes/a.pdf");
    expect(await s.get("u1/resumes/a.pdf")).toBeNull();
  });
  it("rejects traversal and odd keys", async () => {
    for (const key of ["../escape.pdf", "u1/../../x", "/abs", "u1//a", "u1/a b.pdf", ""]) {
      await expect(s.put(key, new Uint8Array([1]), "x")).rejects.toThrow(/Invalid object key/);
    }
  });
});
