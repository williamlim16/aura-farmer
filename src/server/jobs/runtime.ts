/**
 * Dependencies for the standalone worker process (no Next.js, no server-only).
 * The worker must share state with the web app, so in-process drivers are
 * rejected: Postgres for repositories/queue, file (dev) or S3 for storage.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "~/server/db/schema";
import { createPostgresRepos } from "~/server/repos/postgres";
import { getStorage } from "~/server/storage/select";
import { PostgresJobQueue } from "./postgres";

export function createWorkerRuntime(env: NodeJS.ProcessEnv = process.env) {
  if (env.REPO_DRIVER !== "postgres") throw new Error("The worker process needs REPO_DRIVER=postgres (shared with the web app).");
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required for the worker.");
  const storage = getStorage(env);
  if (storage.driver === "memory") throw new Error("The worker process needs STORAGE_DRIVER=file (dev) or s3.");
  const conn = postgres(env.DATABASE_URL, { max: 4, idle_timeout: 30 });
  const db = drizzle(conn, { schema });
  return { repos: createPostgresRepos(db), queue: new PostgresJobQueue(db), storage, close: () => conn.end({ timeout: 5 }) };
}
