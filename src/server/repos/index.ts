import "server-only";

import { createMemoryRepos } from "./memory";
import { RepoError, type Repos } from "./types";

export { RepoError } from "./types";
export type * from "./types";

// Survive Next.js dev HMR so in-memory data is not wiped on every edit.
const globalForRepos = globalThis as unknown as { __afRepos?: Promise<Repos> };

/**
 * REPO_DRIVER=memory (default outside production) or postgres.
 * Memory is refused in production so it can never be mistaken for persistence.
 */
export function getRepos(env: NodeJS.ProcessEnv = process.env): Promise<Repos> {
  const driver = env.REPO_DRIVER ?? (env.NODE_ENV === "production" ? "postgres" : "memory");
  if (driver === "memory") {
    if (env.NODE_ENV === "production") {
      return Promise.reject(new RepoError("In-memory repositories are not allowed in production.", "config"));
    }
    return (globalForRepos.__afRepos ??= Promise.resolve(createMemoryRepos()));
  }
  if (driver !== "postgres") return Promise.reject(new RepoError(`Unknown REPO_DRIVER "${driver}".`, "config"));
  return (globalForRepos.__afRepos ??= (async () => {
    const [{ db }, { createPostgresRepos }] = await Promise.all([import("~/server/db"), import("./postgres")]);
    return createPostgresRepos(db);
  })());
}
