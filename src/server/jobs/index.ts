import "server-only";

import { getRepos } from "~/server/repos";
import { MemoryJobQueue } from "./memory";
import type { JobQueue } from "./types";

export type * from "./types";
export { JobError } from "./types";

const g = globalThis as unknown as { __afQueue?: Promise<JobQueue> };

/** The queue always lives next to the repositories (same process or same database). */
export function getQueue(env: NodeJS.ProcessEnv = process.env): Promise<JobQueue> {
  return (g.__afQueue ??= (async () => {
    const repos = await getRepos(env);
    if (repos.driver === "memory") return new MemoryJobQueue(repos);
    const [{ db }, { PostgresJobQueue }] = await Promise.all([import("~/server/db"), import("./postgres")]);
    return new PostgresJobQueue(db);
  })());
}
