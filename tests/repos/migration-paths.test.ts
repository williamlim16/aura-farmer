/**
 * Both ways the schema can reach Supabase, and the rollback, on PGlite:
 *  1. empty database: full baseline migration (covered by createTestDb)
 *  2. team tables already pushed: team DDL first, then
 *     supabase/apply-workflow-tables.sql, then apply-policies.sql
 *  3. rollback-apply-workflow.sql removes only our tables; team data stays
 */
import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const statements = (sql: string) => sql.split("--> statement-breakpoint").map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
const TEAM = ["post", "user_profile", "experience", "education", "resume"];
const OURS = ["candidate_profile", "job_posting", "application", "apply_job", "apply_job_log"];

async function tables(pg: PGlite) {
  const r = await pg.query<{ t: string }>(`select replace(table_name, 'aura-farmer_', '') as t from information_schema.tables where table_name like 'aura-farmer_%' order by 1`);
  return r.rows.map((x) => x.t);
}

async function authStub(pg: PGlite) {
  await pg.exec(`create schema auth; create table auth.users (id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$; create role authenticated;`);
}

describe("migration paths", () => {
  it("team tables already exist (db:push) -> apply-workflow-tables.sql + policies", async () => {
    const pg = new PGlite();
    const baseline = statements(read("drizzle/0000_baseline.sql"));
    const isTeam = (s: string) => TEAM.some((t) => new RegExp(`(TABLE|ON) "aura-farmer_${t}"`).test(s));
    for (const s of baseline.filter(isTeam)) await pg.exec(s);
    await pg.exec(`insert into "aura-farmer_resume" (user_id, file_name, storage_path, mime_type, file_size, created_at) values ('aaaaaaaa-0000-4000-8000-000000000001', 'team.pdf', 'u/team.pdf', 'application/pdf', 1, now())`);
    expect(await tables(pg)).toEqual([...TEAM].sort());

    for (const s of statements(read("supabase/apply-workflow-tables.sql"))) await pg.exec(s);
    expect(await tables(pg)).toEqual([...TEAM, ...OURS].sort());
    await authStub(pg);
    await pg.exec(`insert into auth.users values ('aaaaaaaa-0000-4000-8000-000000000001')`);
    await pg.exec(read("supabase/apply-policies.sql"));

    // Rollback removes only our tables; the team's row survives.
    await pg.exec(read("supabase/rollback-apply-workflow.sql"));
    expect(await tables(pg)).toEqual([...TEAM].sort());
    expect((await pg.query(`select count(*)::int as n from "aura-farmer_resume"`)).rows[0]).toEqual({ n: 1 });
    await pg.close();
  });

  it("the workflow-only file contains no team-table DDL", () => {
    const s = read("supabase/apply-workflow-tables.sql");
    for (const t of TEAM) expect(s).not.toMatch(new RegExp(`CREATE TABLE "aura-farmer_${t}"`));
    expect(s).toMatch(/REFERENCES "public"\."aura-farmer_resume"/); // FKs to the team's resume table
  });
});
