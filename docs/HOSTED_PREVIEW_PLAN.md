# Hosted preview: configuration checklist and integration plan

**Personal preview:** `aura-farmer-jason-test` (personal Vercel scope, Vercel Authentication on).
**Working URL:** https://aura-farmer-jason-test-7iuj4r2b2-jasonyuhangzhang-6189.vercel.app
**Supabase:** the team project `ahtnpmiofffmecpdxyow`. Nothing in it has been changed.

## 1. Read-only database inspection (you do step 1; nothing is printed)

1. In the Supabase Dashboard, open **Connect** (top bar), then **Connection string**, then **Session pooler** (IPv4-compatible, port 5432). Copy the URI and replace `[YOUR-PASSWORD]` with the database password. (Use **Project Settings → Database → Reset database password** if you don't know it, but only if the team agrees, because resetting breaks existing connections.)
2. Add it to `~/Projects/aura-farmer/.env.local` yourself, on a new line `DATABASE_URL=…`. The file is gitignored, owner-only, and excluded from Vercel uploads (`.vercelignore`).
3. Run `npx tsx --env-file=.env.local scripts/supabase/inspect-readonly.ts`. It runs in a `READ ONLY` transaction, reads only catalog metadata (no user rows), never prints the URL, and reports:
   - missing or different tables and columns against this branch
   - RLS status and policies
   - Drizzle migration history
   - bucket privacy settings

A dedicated read-only role is safer than the owner connection, if the team prefers one:
```sql
create role readonly_inspect login password '<strong-password>';
grant usage on schema public, drizzle, storage to readonly_inspect;
grant select on all tables in schema information_schema to readonly_inspect;
```

## 2. Vercel preview environment variables

| Variable | Secret | Status | Value / note |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | no | Set | Team project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | no | Set | Publishable key (browser-safe) |
| `SKIP_ENV_VALIDATION` | no | Set (temporary) | Remove once the values below exist |
| `DATABASE_URL` | **yes** | Missing | **Transaction pooler** (port 6543) for serverless. Note: the team's `src/server/db/index.ts` uses postgres-js with prepared statements, which the transaction pooler doesn't support. Either use the Session pooler (5432; fine for a low-traffic preview) or add `prepare: false` in a team-approved change |
| `BUCKET_ACCESS_KEY`, `BUCKET_SECRET_KEY` | **yes** | Missing | S3 key pair (required by `src/env.js`) |
| `BUCKET_S3_ENDPOINT` | no | Missing | `https://ahtnpmiofffmecpdxyow.storage.supabase.co/storage/v1/s3` |
| `BUCKET_REGION` / `BUCKET_NAME` | no | Missing | `ap-southeast-1` / `aura-farmer-bucket` |
| `STORAGE_DRIVER`, `REPO_DRIVER` | no | Optional | Production defaults are `s3` / `postgres` |
| `APPLY_WORKER_ENABLED` | no | Leave unset | Only after a worker is deployed against the same database |
| `LLM_*`, `JEV_*` | yes | Leave unset | Rules only; no paid calls |

Add secrets yourself: `npx vercel env add DATABASE_URL --environment preview --sensitive` (it prompts for the value; nothing goes in shell history). Then redeploy: `npx vercel deploy --target preview`.

## 3. Supabase Auth changes needed (not made; for approval)

1. **Redirect URLs:** Authentication → URL Configuration → add `https://aura-farmer-jason-test-*-jasonyuhangzhang-6189.vercel.app/**`. The team's code redirects to `/profile`, `/auth/oauth?next=…` and `/auth/update-password` on the current origin. Password sign-in works without this; email confirmation, OAuth and password reset need it.
2. **Test accounts:** email confirmation is ON, so fictional addresses can't confirm. Smallest safe option: in Authentication → Users → **Add user** (Auto Confirm User), create `test-applicant-a@…` and `test-applicant-b@…` using an address domain the team controls. That's two rows in `auth.users`, removable later. No settings change.
3. **Google OAuth on previews** also needs the redirect URL (item 1) plus the Google console's authorised redirect (already Supabase's callback, so usually no change).

## 4. Does `vercel.json` / Node 22 affect the team's deployment when merged?

- **`"framework": "nextjs"`:** the team project already builds this repo as Next.js, so there's no change. It only overrides a mis-detected preset.
- **`"engines": { "node": "22.x" }`:** Vercel uses this instead of the project's Node setting. The team project's current Node version isn't visible to us; if it's 20.x or 24.x, merging switches it to 22.x (an active LTS, matching CI). No known incompatibility.
- **Font fix (`layout.tsx`):** this is what currently breaks every team build, so merging *unblocks* their deployments. Their builds also need the env variables from section 2 set in their project (the other cause of their failures).

## 5. Integration plan (each step verifiable on the hosted preview)

| # | Step | Needs | Verified by |
|---|---|---|---|
| 1 | Real Supabase login | Test users (3.2), redirect URL (3.1) | Sign in on the preview: `/profile` and `/apply` load; sign out; a second user is isolated |
| 2 | Schema in place | Inspection result (section 1), then an approved path from `docs/STAGING_CHECKLIST.md` (likely `supabase/apply-workflow-tables.sql` plus policies) | Inspection script shows all tables OK |
| 3 | Postgres persistence | `DATABASE_URL` in the preview env | Save profile, reload, it persists across browsers |
| 4 | Private resume storage | `BUCKET_*` in the preview env | Upload on `/apply/profile`; object under `<uid>/resumes/`; download through the app only |
| 5 | Job import, matching, tailoring | Steps 1-4 (no extra services; job boards are read live) | Import a public posting, match, tailored PDF downloads |
| 6 | Browser worker | A container host (Railway, Render or Fly) running `Dockerfile.worker` against the same `DATABASE_URL` and bucket, plus Docker locally to build and test the image. Then `APPLY_WORKER_ENABLED=1` | A representative application reaches "Filled, awaiting your review" with screenshot and logs |
| 7 | Hosted end-to-end | Steps 1-6 | Same stages as `scripts/e2e/full-journey.ts`, run against the preview |

**Immediate success criterion** (sign in, upload, save and reload the profile, import and evaluate a job) requires steps 1-5 only. The worker isn't needed for it.

## 6. Smallest actions to unblock

| Blocker | Who | Smallest action |
|---|---|---|
| Schema unknown | You | Put the Session pooler URI in `aura-farmer/.env.local`, then tell me to run the inspection |
| Login on preview | Teammate with Supabase admin | Create 2 auto-confirmed test users; add the preview redirect URL |
| Schema missing / mismatched | Team (approval) | Approve one migration path after reading the inspection result |
| Persistence and storage online | You | `vercel env add` for `DATABASE_URL`, `BUCKET_ACCESS_KEY`, `BUCKET_SECRET_KEY` (preview, sensitive) |
| Worker | You | Approve installing Docker locally and pick a host (free tiers exist; check limits) |
