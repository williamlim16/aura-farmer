/**
 * One contract, two implementations: in-memory and Drizzle/Postgres (PGlite
 * with the real generated migration applied). Any future implementation must
 * pass the same suite.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getRepos } from "~/server/repos";
import { createMemoryRepos } from "~/server/repos/memory";
import { createPostgresRepos } from "~/server/repos/postgres";
import type { Repos } from "~/server/repos/types";
import { syntheticProfile } from "../helpers/apply-harness";
import { createTestDb } from "../helpers/pglite";

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const BOB = "bbbbbbbb-0000-4000-8000-000000000002";

const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const c of closers) await c();
});

const impls: [string, () => Promise<Repos>][] = [
  ["memory", async () => createMemoryRepos()],
  [
    "postgres (PGlite + migration)",
    async () => {
      const t = await createTestDb();
      closers.push(t.close);
      return createPostgresRepos(t.db);
    },
  ],
];

describe.each(impls)("repositories: %s", (_name, make) => {
  let repos: Repos;
  beforeEach(async () => {
    repos = await make();
  });

  const resumeInput = (key = `${ALICE}/resumes/${crypto.randomUUID()}.pdf`) => ({ storageKey: key, kind: "pdf" as const, filename: "cv.pdf", sizeBytes: 1234 });

  describe("resumes", () => {
    it("creates, reads and lists latest per user", async () => {
      const a = await repos.resumes.create(ALICE, resumeInput());
      await new Promise((r) => setTimeout(r, 5));
      const b = await repos.resumes.create(ALICE, resumeInput());
      expect(await repos.resumes.get(ALICE, a.id)).toMatchObject({ id: a.id, userId: ALICE, kind: "pdf" });
      expect((await repos.resumes.latest(ALICE))?.id).toBe(b.id);
      expect(await repos.resumes.latest(BOB)).toBeNull();
    });

    it("hides other users' resumes and refuses cross-user delete", async () => {
      const a = await repos.resumes.create(ALICE, resumeInput());
      expect(await repos.resumes.get(BOB, a.id)).toBeNull();
      expect(await repos.resumes.delete(BOB, a.id)).toBe(false);
      expect(await repos.resumes.get(ALICE, a.id)).not.toBeNull();
      expect(await repos.resumes.delete(ALICE, a.id)).toBe(true);
    });

    it("treats malformed ids as missing", async () => {
      expect(await repos.resumes.get(ALICE, "not-a-uuid'; drop table x;--")).toBeNull();
    });

    it("rejects duplicate storage keys", async () => {
      const key = `${ALICE}/resumes/dup.pdf`;
      await repos.resumes.create(ALICE, resumeInput(key));
      await expect(repos.resumes.create(ALICE, resumeInput(key))).rejects.toThrow();
    });
  });

  describe("profiles", () => {
    it("upserts with incrementing versions and keeps users separate", async () => {
      const p = syntheticProfile();
      const v1 = await repos.profiles.save(ALICE, p);
      expect(v1.version).toBe(1);
      p.summary = "Updated";
      const v2 = await repos.profiles.save(ALICE, p);
      expect(v2.version).toBe(2);
      expect((await repos.profiles.get(ALICE))?.profile.summary).toBe("Updated");
      expect(await repos.profiles.get(BOB)).toBeNull();
    });

    it("enforces optimistic concurrency", async () => {
      await repos.profiles.save(ALICE, syntheticProfile(), { expectedVersion: 0 });
      await expect(repos.profiles.save(ALICE, syntheticProfile(), { expectedVersion: 0 })).rejects.toMatchObject({ code: "conflict" });
      await repos.profiles.save(ALICE, syntheticProfile(), { expectedVersion: 1 });
      await expect(repos.profiles.save(ALICE, syntheticProfile(), { expectedVersion: 1 })).rejects.toMatchObject({ code: "conflict" });
    });

    it("links the source resume and preserves it on later saves", async () => {
      const r = await repos.resumes.create(ALICE, resumeInput());
      await repos.profiles.save(ALICE, syntheticProfile(), { resumeId: r.id });
      const again = await repos.profiles.save(ALICE, syntheticProfile());
      expect(again.resumeId).toBe(r.id);
    });

    it("returns copies: mutating a result does not change stored data", async () => {
      await repos.profiles.save(ALICE, syntheticProfile());
      const got = await repos.profiles.get(ALICE);
      got!.profile.skills.push("Injected");
      expect((await repos.profiles.get(ALICE))!.profile.skills).not.toContain("Injected");
    });
  });

  describe("applications", () => {
    const newApp = () => ({ targetKey: "basic.html", targetUrl: "http://127.0.0.1/forms/basic.html", title: "Engineer", company: "Example Corp", useLlm: false, profileSnapshot: syntheticProfile(), resumeId: null });

    it("creates as draft and lists newest first, per user", async () => {
      const a = await repos.applications.create(ALICE, newApp());
      await new Promise((r) => setTimeout(r, 5));
      const b = await repos.applications.create(ALICE, newApp());
      await repos.applications.create(BOB, newApp());
      expect(a.status).toBe("draft");
      expect((await repos.applications.list(ALICE)).map((x) => x.id)).toEqual([b.id, a.id]);
    });

    it("enforces the status state machine", async () => {
      const a = await repos.applications.create(ALICE, newApp());
      await expect(repos.applications.update(ALICE, a.id, { status: "submitted_by_user" })).rejects.toMatchObject({ code: "invalid_transition" });
      await repos.applications.update(ALICE, a.id, { status: "queued" });
      await repos.applications.update(ALICE, a.id, { status: "running" });
      const done = await repos.applications.update(ALICE, a.id, { status: "ready_for_review", report: null });
      expect(done.status).toBe("ready_for_review");
      const sub = await repos.applications.update(ALICE, a.id, { status: "submitted_by_user" });
      expect(sub.submittedAt).toBeInstanceOf(Date);
      await expect(repos.applications.update(ALICE, a.id, { status: "queued" })).rejects.toMatchObject({ code: "invalid_transition" });
    });

    it("refuses cross-user reads and updates", async () => {
      const a = await repos.applications.create(ALICE, newApp());
      expect(await repos.applications.get(BOB, a.id)).toBeNull();
      await expect(repos.applications.update(BOB, a.id, { status: "queued" })).rejects.toMatchObject({ code: "not_found" });
      expect((await repos.applications.get(ALICE, a.id))!.status).toBe("draft");
    });
  });
});

describe("getRepos driver selection", () => {
  it("refuses in-memory repositories in production", async () => {
    await expect(getRepos({ NODE_ENV: "production", REPO_DRIVER: "memory" } as NodeJS.ProcessEnv)).rejects.toMatchObject({ code: "config" });
  });
  it("rejects unknown drivers", async () => {
    await expect(getRepos({ NODE_ENV: "development", REPO_DRIVER: "sqlite" } as NodeJS.ProcessEnv)).rejects.toMatchObject({ code: "config" });
  });
});
