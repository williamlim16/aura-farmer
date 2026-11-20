/**
 * In-process Postgres (PGlite, WASM) with the generated Drizzle migrations
 * applied. Proves the migration SQL is valid and lets the Postgres
 * repositories run against a real database without Docker.
 */
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "~/server/db/schema";

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../drizzle");

export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, client, close: () => client.close() };
}
