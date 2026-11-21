/**
 * One command for the full local workflow without Docker or Supabase access:
 *   pnpm dev:stack
 *
 *   dev database   PGlite over the Postgres protocol   127.0.0.1:54329
 *   mock auth      local Supabase Auth stand-in         http://localhost:54321
 *   web app        next dev (team app, unmodified auth) http://localhost:3000
 *   worker         separate process running Playwright
 *
 * Then open http://localhost:54321/dev-login and pick a synthetic user.
 * Development only: refuses NODE_ENV=production. Data lives in .data/.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { startDevDb } from "./db";
import { startMockAuth } from "./mock-auth";

export function stackEnv(opts: { databaseUrl: string; authUrl: string; storageDir: string; llm?: string }): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "development",
    DATABASE_URL: opts.databaseUrl,
    REPO_DRIVER: "postgres",
    STORAGE_DRIVER: "file",
    FILE_STORAGE_DIR: opts.storageDir,
    NEXT_PUBLIC_SUPABASE_URL: opts.authUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-mock-publishable-key",
    LLM_PROVIDER: opts.llm ?? process.env.LLM_PROVIDER ?? "mock",
    // src/env.js (team) requires these; the local stack never talks to Supabase
    // Storage, so placeholders keep env validation happy without real keys.
    BUCKET_ACCESS_KEY: process.env.BUCKET_ACCESS_KEY ?? "local-stack-placeholder",
    BUCKET_SECRET_KEY: process.env.BUCKET_SECRET_KEY ?? "local-stack-placeholder",
    // Required by the team's job-discovery backend (src/env.js); the local stack never calls Tavily.
    TAVILY_API_KEY: process.env.TAVILY_API_KEY ?? "local-stack-placeholder",
  };
}

function run(name: string, cmd: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  const prefix = (d: Buffer) => d.toString().split("\n").filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  child.stdout?.on("data", prefix);
  child.stderr?.on("data", prefix);
  return child;
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("dev:stack must not run in production.");
  const appPort = Number(process.env.PORT ?? 3000);
  const appUrl = `http://localhost:${appPort}`;
  const db = await startDevDb({ port: Number(process.env.DEV_DB_PORT ?? 54329) });
  const auth = await startMockAuth({ port: Number(process.env.MOCK_AUTH_PORT ?? 54321), appUrl });
  const env = stackEnv({ databaseUrl: db.url, authUrl: auth.url, storageDir: path.resolve(".data/storage") });
  const bin = (n: string) => path.resolve("node_modules/.bin", n);
  const children = [run("web", bin("next"), ["dev", "-p", String(appPort)], env), run("worker", bin("tsx"), ["scripts/worker.ts"], env)];

  console.log(`\n  Aura Farmer local stack\n  1. Sign in (synthetic users): ${auth.url}/dev-login\n  2. App: ${appUrl}/apply\n  LLM tier: ${env.LLM_PROVIDER} · data: .data/ · Ctrl+C to stop\n`);

  const stop = async () => {
    for (const c of children) c.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 1500));
    await auth.close();
    await db.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
  for (const c of children) c.on("exit", (code) => code && code !== 0 && console.error(`[stack] a process exited with code ${code}`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  void main().catch((e: unknown) => {
    console.error("[stack]", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
