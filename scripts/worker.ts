/**
 * Browser worker process. Runs outside Next.js.
 *   REPO_DRIVER=postgres DATABASE_URL=... STORAGE_DRIVER=file pnpm worker
 * (pnpm dev:stack starts this for you with a local database.)
 */
import { chromium } from "playwright";

import { startFormHost } from "~/server/jobs/form-host";
import { createWorkerRuntime } from "~/server/jobs/runtime";
import { BrowserWorker } from "~/server/jobs/worker";
import { createJevProviders, createLlmProviders } from "~/server/llm/factory";

async function main() {
  const rt = createWorkerRuntime();
  const formHost = await startFormHost();
  const worker = new BrowserWorker({
    ...rt,
    formHost,
    launchBrowser: () => chromium.launch({ headless: process.env.WORKER_HEADED !== "1" }),
    jobTimeoutMs: Number(process.env.WORKER_JOB_TIMEOUT_MS ?? 90_000),
    extraProviders: () => createLlmProviders(process.env),
    selectionProviders: () => createJevProviders(process.env),
  });
  worker.start();
  console.log(`[worker] ${worker.workerId} polling; test forms on ${formHost.origin}`);
  const stop = async () => {
    console.log("[worker] stopping after the current job…");
    await worker.stop();
    await formHost.close();
    await rt.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}

void main().catch((e: unknown) => {
  console.error("[worker] failed to start:", e instanceof Error ? e.message : e);
  process.exit(1);
});
