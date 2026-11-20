# Supabase integration checklist

Everything in this branch runs without Supabase (`STORAGE_DRIVER=memory`, the default outside production). This list covers what to verify and change once someone has Dashboard access.

## 1. The `SignatureDoesNotMatch` upload error

**Probable cause: the region and bucket name in `.env.local` don't match the project.**

These findings come from read-only S3 `ListObjects`/`ListBuckets` calls made with the local key pair on 2026-11-21. No uploads were made and no secrets were printed. Confirm them in the Dashboard before changing anything.

| Setting | In `.env.local` | What the probe saw |
|---|---|---|
| `BUCKET_REGION` | `ap-southeast-2` | Requests are only accepted when signed with `ap-southeast-1` (or the generic `us-east-1`). Every other region returns `SignatureDoesNotMatch`. |
| `BUCKET_NAME` | a 7-character name | Not found. The only bucket visible to these keys is `aura-farmer-bucket`. |
| Endpoint, key format | — | Fine. Endpoint is `https://<ref>.storage.supabase.co/storage/v1/s3`, matching `NEXT_PUBLIC_SUPABASE_URL`. Key lengths are 32 and 64 hex characters. |
| Checksum headers (newer AWS SDK) | — | Not the cause. The error is the same with `requestChecksumCalculation: "WHEN_REQUIRED"`. |

The storage layer now reports these failures as `storage_config`, with a hint in the server logs, instead of a generic 500 (`src/server/storage/s3.ts`, `classifyS3Error`).

## 2. What to verify in the Dashboard

- [ ] **Settings → General**: project region. Expected `ap-southeast-1` (Singapore).
- [ ] **Storage → Buckets**: decide whether resumes go in `aura-farmer-bucket` or in a dedicated private `resumes` bucket. Recommended: a dedicated bucket, **Private**, file size limit 5 MB, allowed MIME types `application/pdf` and `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
- [ ] **Storage → S3 Connection**: endpoint, region, and an access key pair *for this environment*. S3 keys **bypass RLS** and have full storage access, so they are server-only and must never get a `NEXT_PUBLIC_` prefix.
- [ ] **Authentication → URL configuration**: site URL and redirect URLs include `http://localhost:3000` and the deploy URL. The team's OAuth and confirm routes depend on these.

## 3. Choose the upload path

| Option | Status | Notes |
|---|---|---|
| **A. S3 keys on the server** | Implemented (`S3Storage`) | Works today once the env vars are correct. The server enforces per-user keys (`<userId>/resumes/<uuid>.<ext>`), not RLS. |
| **B. supabase-js with the user's session** | Not yet implemented | RLS applies, so the database itself enforces per-user access. Recommended for production. Add a `SupabaseStorage implements ObjectStorage` that uses `createClient()` from `~/lib/supabase/server`. Nothing else changes. |

Storage policies for option B (bucket `resumes`; the first path segment is the user id, which `resumeKey()` already produces):

```sql
create policy "resume insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "resume select own" on storage.objects for select to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "resume delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);
```

## 4. Environment variables

| Variable | Where | Notes |
|---|---|---|
| `STORAGE_DRIVER` | server | `memory` (default in dev/test) or `s3`. Production defaults to `s3` and refuses `memory`. |
| `BUCKET_S3_ENDPOINT`, `BUCKET_REGION`, `BUCKET_NAME` | server | Option A only. |
| `BUCKET_ACCESS_KEY`, `BUCKET_SECRET_KEY` | server, secret | Option A only. |

TODO: add these to `src/env.js` as optional server vars. I left that file alone so teammates' builds don't start failing validation.

## 5. Database (Drizzle, tables prefixed `aura-farmer_`)

Not created yet. Proposed tables:

- `resumes`: `id`, `user_id` (uuid, references auth.users), `storage_key`, `kind`, `filename`, `size_bytes`, `created_at`
- `candidate_profiles`: `user_id` (primary key), `profile` jsonb (validated by `candidateProfileSchema`), `updated_at`
- `applications`: `id`, `user_id`, `job_url`, `company`, `title`, `status` (`draft` | `ready_for_review` | `submitted_by_user` | …), `autofill_report` jsonb, `submitted_at`

Drizzle connects with `DATABASE_URL` as the database owner, which **bypasses RLS**. Every query must filter on `user_id` from `supabase.auth.getClaims()`. Enable RLS anyway in case these tables are later read through supabase-js.

## 6. Middleware gotcha

`src/lib/supabase/middleware.ts` redirects every unauthenticated request outside `/`, `/login` and `/auth` to `/auth/login`. That includes `POST /api/resume/upload`. An expired session therefore gets a 307 to an HTML page instead of the route's JSON 401, and the UI shows a generic upload error. Suggestion (needs team agreement, since it's shared code): skip the redirect for `/api/*` and let routes return 401.

## 7. Integration tests to run once access is granted

1. With the corrected env, run the read-only `ListObjectsV2` on the chosen bucket. Expect OK.
2. Sign in on `/resume`, upload a synthetic PDF, and confirm the object appears under `<your-uid>/resumes/`.
3. Upload the same file as a DOCX. Then try `.txt`, a renamed PDF and a 6 MB file. Expect 400s with nothing stored.
4. Sign out and POST to the route. Expect 401 (or a redirect, see section 6), with nothing stored.
5. Option B only: try reading another user's key with your session. Expect it to be denied.
6. Use a bad region on purpose. Expect a 500 with code `storage_config` and a logged hint, and no secret values in the logs.
7. Delete the test objects afterwards.
