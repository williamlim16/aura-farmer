import { afterEach, describe, expect, it, vi } from "vitest";

import { createApplicationHandler, ingestHandler, workerAvailable, type ApiDeps } from "~/server/api/handlers";
import { isLocalAuthInHostedDeployment } from "~/server/api/hosting";
import { MemoryJobQueue } from "~/server/jobs/memory";
import { createMemoryRepos } from "~/server/repos/memory";
import { MemoryStorage } from "~/server/storage/memory";
import { fileFrom, makePdf } from "../helpers/resume-fixtures";

const E = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
afterEach(() => vi.unstubAllEnvs());

describe("hosted deployment guards", () => {
  it("rejects local (mock) auth URLs on hosted deployments only", () => {
    expect(isLocalAuthInHostedDeployment(E({ VERCEL: "1", NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" }))).toBe(true);
    expect(isLocalAuthInHostedDeployment(E({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }))).toBe(true);
    expect(isLocalAuthInHostedDeployment(E({ VERCEL: "1", NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" }))).toBe(false);
    expect(isLocalAuthInHostedDeployment(E({ NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" }))).toBe(false);
  });

  it("hosted deployments without a worker keep applications prepared instead of queueing them", async () => {
    expect(workerAvailable(E({ NODE_ENV: "production" }))).toBe(false);
    expect(workerAvailable(E({ NODE_ENV: "production", APPLY_WORKER_ENABLED: "1" }))).toBe(true);
    const repos = createMemoryRepos();
    const deps: ApiDeps = { repos, storage: new MemoryStorage(), queue: new MemoryJobQueue(repos) };
    const U = "aaaaaaaa-0000-4000-8000-000000000001";
    await ingestHandler(U, fileFrom(await makePdf(), "cv.pdf"), deps);
    vi.stubEnv("NODE_ENV", "production");
    const r = await createApplicationHandler(U, { targetKey: "basic" }, deps);
    expect(r).toMatchObject({ status: 503, body: { code: "worker_unavailable", application: { status: "draft" } } });
  });
});
