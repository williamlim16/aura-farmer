# Staging integration: migration impact, rollback, checklist

Nothing below has been applied to any shared Supabase resource. Apply to a **staging/branch project first**.

## 1. Migration impact

`drizzle/0000_baseline.sql` was generated from the merged schema. It contains 10 tables:

| Owner | Tables | Notes |
|---|---|---|
| Team (`main`) | `post`, `user_profile`, `experience`, `education`, `resume` | May already exist if the team used `pnpm db:push` |
| Apply workflow | `candidate_profile`, `job_posting`, `application`, `apply_job`, `apply_job_log` | New |

**Choose the path by checking the database first:**
```sql
select table_name from information_schema.tables where table_name like 'aura-farmer_%';
```
- **No team tables:** run `pnpm db:migrate` (applies the baseline), then `supabase/apply-policies.sql`.
- **Team tables exist (created by push):** run `supabase/apply-workflow-tables.sql`, then `supabase/apply-policies.sql`. Don't run the baseline: it would fail on the existing tables. Pick one convention afterwards; mixing `push` and `migrate` drifts.
- **Destructive changes:** none in either path. Only new tables, indexes and FKs are added. `apply-policies.sql` enables RLS on the team's `resume` table (select-own policy) and adds FKs to `auth.users`. The team's server actions use the Drizzle owner connection, which bypasses RLS, so they are unaffected.

Both paths are tested on PGlite in `tests/repos/migration-paths.test.ts` and `tests/repos/rls.test.ts`.

## 2. Rollback

1. Take a backup (Dashboard > Database > Backups) or a `pg_dump` of the `aura-farmer_*` tables.
2. Run `supabase/rollback-apply-workflow.sql`. It drops only the five workflow tables, plus the resume FK and policy we added. The team's tables and data stay (tested).
3. Uploaded objects under `<user-id>/resumes/` and `<user-id>/applications/` stay in the bucket. Remove them separately if needed.

## 3. Findings for the team schema

- Team tables use Drizzle `$defaultFn` for `created_at` (client-side). Inserts that don't go through Drizzle (SQL, supabase-js) must set it. Consider `defaultNow()`.
- `resume.storage_path` has no unique index. Our keys are UUID-based, but consider adding one.
- Team tables have no RLS yet. Policies like `supabase/apply-policies.sql` are recommended before any client-side (supabase-js) reads.

## 4. Environment variables

| Variable | Where | Required for |
|---|---|---|
| `DATABASE_URL` | server | Drizzle (app + worker). Use the pooled connection string for the app |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | Auth |
| `BUCKET_ACCESS_KEY`, `BUCKET_SECRET_KEY` | server secret | Required by `src/env.js`; S3 storage |
| `BUCKET_S3_ENDPOINT`, `BUCKET_REGION`, `BUCKET_NAME` | server | Our storage driver (team module hard-codes region and bucket) |
| `REPO_DRIVER=postgres`, `STORAGE_DRIVER=s3` | server | Production defaults; memory/file refused in production |
| `ALLOW_DEV_S3=1` | dev only | Opt in to the shared bucket outside production |
| `LLM_PROVIDER`, `LLM_ALLOW_PAID_CALLS`, `APPLY_LLM_API_KEY` | server | Optional LLM tier |
| `JEV_PROVIDER`, `JEV_ALLOW_PAID_CALLS`, `APPLY_JEV_API_KEY` | server | Optional Jev tier |

## 5. Staging checklist

- [ ] Staging project or branch; backup taken
- [ ] Table check (section 1); apply the matching path; apply `apply-policies.sql`
- [ ] `SUPABASE_LIVE_TEST=1 … npx vitest run tests/integration/supabase-live.test.ts` with a dedicated test user (sign-in plus token verification, read-only)
- [ ] Repository contract suite against staging, using a staging-only database URL (it writes test rows)
- [ ] App against staging: sign up → `/apply/profile` upload (`STORAGE_DRIVER=s3`) → job → application. The worker uses `REPO_DRIVER=postgres`
- [ ] Second user cannot see the first user's application (404) or read their rows via supabase-js (RLS)
- [ ] Rollback rehearsal on staging (section 2)
