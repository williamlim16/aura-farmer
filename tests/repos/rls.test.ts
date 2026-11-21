/**
 * Applies supabase/apply-policies.sql to PGlite with a minimal stand-in for
 * Supabase's auth schema (auth.users, auth.uid(), the authenticated role) and
 * checks the policies isolate users. The stub is test-only.
 */
import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb } from "../helpers/pglite";

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const BOB = "bbbbbbbb-0000-4000-8000-000000000002";
let t: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  t = await createTestDb();
  const c = t.client;
  await c.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role authenticated;
    grant usage on schema public, auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    insert into auth.users values ('${ALICE}'), ('${BOB}');
  `);
  await c.exec(fs.readFileSync(path.resolve(import.meta.dirname, "../../supabase/apply-policies.sql"), "utf8"));
  await c.exec(`grant select on all tables in schema public to authenticated;`);
  await c.exec(`
    insert into "aura-farmer_resume" (user_id, storage_path, file_name, mime_type, file_size, created_at) values
      ('${ALICE}', 'a/1.pdf', 'a.pdf', 'application/pdf', 1, now()), ('${BOB}', 'b/1.pdf', 'b.pdf', 'application/pdf', 1, now());
  `);
});
afterAll(async () => t?.close());

async function asUser(sub: string, q: string) {
  await t.client.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${sub}', false);`);
  try {
    return (await t.client.query<{ user_id: string }>(q)).rows;
  } finally {
    await t.client.exec(`reset role;`);
  }
}

describe("Supabase RLS policies (PGlite with auth stub)", () => {
  it("a user sees only their own rows", async () => {
    const rows = await asUser(ALICE, `select user_id from "aura-farmer_resume"`);
    expect(rows.map((r) => r.user_id)).toEqual([ALICE]);
  });
  it("clients cannot write directly", async () => {
    await expect(asUser(ALICE, `insert into "aura-farmer_resume" (user_id, storage_path, file_name, mime_type, file_size, created_at) values ('${ALICE}', 'x', 'x', 'application/pdf', 1, now())`)).rejects.toThrow();
  });
  it("foreign keys reject unknown users", async () => {
    await expect(t.client.exec(`insert into "aura-farmer_resume" (user_id, storage_path, file_name, mime_type, file_size, created_at) values ('cccccccc-0000-4000-8000-000000000003', 'c', 'c', 'application/pdf', 1, now())`)).rejects.toThrow(/foreign key/);
  });
});
