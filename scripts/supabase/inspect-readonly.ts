/**
 * READ-ONLY schema inspection of the Supabase database.
 *   npx tsx --env-file=.env.local scripts/supabase/inspect-readonly.ts
 * - Runs inside a READ ONLY transaction (Postgres rejects any write).
 * - Reads catalog metadata only (tables, columns, RLS, policies, migration
 *   history); never selects rows from application tables.
 * - Never prints the connection string. Compares against our expected schema.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (add it to .env.local; it is never printed).");
  process.exit(2);
}
const EXPECTED: Record<string, string[]> = {
  "aura-farmer_post": ["id", "name", "createdAt", "updatedAt"],
  "aura-farmer_user_profile": ["id", "user_id", "full_name", "headline", "location", "phone", "website_url", "linkedin_url", "github_url", "summary", "skills", "created_at", "updated_at"],
  "aura-farmer_experience": ["id", "user_id", "job_title", "company", "employment_type", "location", "start_date", "end_date", "is_current", "description", "created_at", "updated_at"],
  "aura-farmer_education": ["id", "user_id", "school", "degree", "field_of_study", "location", "start_date", "end_date", "is_current", "grade", "description", "created_at", "updated_at"],
  "aura-farmer_resume": ["id", "user_id", "file_name", "storage_path", "bucket_id", "mime_type", "file_size", "created_at", "updated_at"],
  "aura-farmer_candidate_profile": ["user_id", "profile", "resume_id", "version", "updated_at"],
  "aura-farmer_job_posting": ["id", "user_id", "source", "source_url", "external_id", "title", "company", "location", "description", "requirements", "retrieval", "match", "tailoring", "created_at", "updated_at"],
  "aura-farmer_application": ["id", "user_id", "target_key", "target_url", "title", "company", "status", "use_llm", "profile_snapshot", "resume_id", "posting_id", "report", "error", "created_at", "updated_at", "submitted_at"],
  "aura-farmer_apply_job": ["id", "application_id", "user_id", "status", "attempts", "max_attempts", "run_after", "lease_expires_at", "worker_id", "cancel_requested", "last_error", "created_at", "updated_at"],
  "aura-farmer_apply_job_log": ["id", "job_id", "at", "level", "message"],
};
const TEAM = ["aura-farmer_post", "aura-farmer_user_profile", "aura-farmer_experience", "aura-farmer_education", "aura-farmer_resume"];

const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 15 });
try {
  const report = await sql.begin("read only", async (tx) => {
    const ver = await tx`select current_setting('server_version') as v, current_setting('transaction_read_only') as ro`;
    const tables = await tx`select table_schema, table_name from information_schema.tables where table_schema not in ('pg_catalog','information_schema','auth','storage','realtime','supabase_functions','extensions','graphql','graphql_public','pgsodium','pgsodium_masks','vault','net','supabase_migrations','cron','pgbouncer') and table_type = 'BASE TABLE' order by 1, 2`;
    const cols = await tx`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name like 'aura-farmer_%' order by table_name, ordinal_position`;
    const rls = await tx`select c.relname as table_name, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'aura-farmer_%'`;
    const pols = await tx`select tablename, policyname, cmd, roles::text as roles from pg_policies where schemaname = 'public' order by 1, 2`;
    const drizzle = await tx`select exists (select 1 from information_schema.tables where table_schema = 'drizzle' and table_name = '__drizzle_migrations') as has`;
    const migrations = drizzle[0]?.has ? await tx`select id, hash, created_at from drizzle.__drizzle_migrations order by id` : [];
    const hasStorage = (await tx`select to_regclass('storage.buckets') is not null as has`)[0]?.has;
    const buckets = hasStorage ? await tx`select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id` : [];
    return { ver: ver[0], tables, cols, rls, pols, migrations, buckets };
  });
  console.log(`Postgres ${String(report.ver?.v)} (transaction_read_only=${String(report.ver?.ro)})`);
  console.log(`\nTables outside system schemas (${report.tables.length}):`, report.tables.map((t) => `${String(t.table_schema)}.${String(t.table_name)}`).join(", ") || "(none)");
  const byTable = new Map<string, string[]>();
  for (const c of report.cols) byTable.set(String(c.table_name), [...(byTable.get(String(c.table_name)) ?? []), String(c.column_name)]);
  console.log("\nSchema vs feat/apply-engine:");
  for (const [t, want] of Object.entries(EXPECTED)) {
    const have = byTable.get(t);
    const owner = TEAM.includes(t) ? "team" : "ours";
    if (!have) { console.log(`  MISSING  ${t} (${owner})`); continue; }
    const missing = want.filter((c) => !have.includes(c)), extra = have.filter((c) => !want.includes(c));
    const rls = report.rls.find((r) => r.table_name === t)?.rls;
    console.log(`  ${missing.length || extra.length ? "DIFFERS" : "OK     "}  ${t} (${owner}) rls=${String(rls)}${missing.length ? ` missing cols: ${missing.join(", ")}` : ""}${extra.length ? ` extra cols: ${extra.join(", ")}` : ""}`);
  }
  console.log(`\nRLS policies (${report.pols.length}):`, report.pols.map((p) => `${String(p.tablename)}:${String(p.policyname)}[${String(p.cmd)}]`).join(", ") || "(none)");
  console.log(`Drizzle migration history: ${report.migrations.length ? report.migrations.map((m) => `#${String(m.id)} ${String(m.hash).slice(0, 8)}`).join(", ") : "none (schema was pushed with db:push, or never applied)"}`);
  console.log("Storage buckets:", report.buckets.map((b) => `${String(b.id)} public=${String(b.public)} limit=${String(b.file_size_limit)} mime=${JSON.stringify(b.allowed_mime_types)}`).join("; ") || "(not readable)");
} catch (e) {
  console.error("Inspection failed:", e instanceof Error ? e.message.replace(url, "<DATABASE_URL>") : e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
