# Architecture: apply workflow

```
Browser (Next.js pages: /apply, /apply/profile, /apply/new, /apply/applications/[id])
   │  fetch (apiFetch: session-expiry aware)
   ▼
Next.js route handlers  ── Supabase session (team middleware + getClaims, unmodified)
   src/app/api/{resume/upload, profile, applications, applications/[id], …/logs, …/screenshot}
   │  thin: auth, same-origin check, JSON limits → framework-free handlers
   ▼
src/server/api/handlers.ts   (validation, ownership, state machine, run limit)
   │                 │                         │
   ▼                 ▼                         ▼
Repositories     Object storage            Job queue
(src/server/     (src/server/storage:      (src/server/jobs: memory | postgres)
 repos: memory    memory | file | s3)       enqueue / cancel / claim / heartbeat /
 | postgres)                                complete / fail / logs
   ▲                 ▲                         ▲
   └─────────────────┴──────── Browser worker (separate process: scripts/worker.ts)
                               src/server/jobs/worker.ts
                                 → runApplication (src/server/workflow) in a fresh
                                   Playwright context, egress limited to the form host
                                 → DecisionEngine: rules → Jev → LLM → safety guard
                                 → fill → read back → multi-step → report + screenshot
```

**Ownership.** Every repository and queue method takes the caller's user id, and records owned by someone else look exactly like missing ones. The Postgres implementations filter on `user_id` in every query, because Drizzle connects as the owner and bypasses RLS. `supabase/apply-policies.sql` adds RLS as a second layer.

**Application lifecycle** (`src/lib/applications/status.ts`): `draft → queued → running → ready_for_review → submitted_by_user`, plus `failed` and `cancelled`, which can be retried. `submitted_by_user` is only set when the user explicitly confirms. The system never submits.

**Queue semantics:**
- A job is leased to a worker, which sends heartbeats.
- An expired lease means the worker crashed, so the job is re-claimed until `maxAttempts`.
- Only transient failures are retried, with backoff.
- Cancellation removes a queued job immediately, or sets a flag the running worker sees on its next heartbeat.
- There is at most one active job per application (a partial unique index).
- There are at most 3 active runs per user.
- In Postgres every transition is a single SQL statement (CTEs, `FOR UPDATE SKIP LOCKED`).

## Worker deployment plan

Vercel functions are not a fit for Playwright: short limits, no persistent browser, and a large binary. The plan:

1. **The web app stays on Vercel** (or any Next.js host). It only enqueues and reads; it never launches a browser.
2. **The worker runs as a long-lived container.** Fly.io, Railway, Render or ECS all work. Run `pnpm worker`; the image needs `npx playwright install --with-deps chromium`. Scale horizontally: `SKIP LOCKED` lets several workers share one queue safely.
3. **The queue lives in the same Supabase Postgres**, in the `aura-farmer_apply_job` table, so no extra infrastructure is needed for the MVP. Move to a managed queue only if throughput requires it.
4. **Storage:** resumes and screenshots go to the Supabase S3 bucket (`STORAGE_DRIVER=s3`). The worker reads and writes the same bucket.
5. **Network:** today the worker only reaches its own loopback form host. Before real job sites:
   - an ATS host allowlist
   - DNS resolution with private-IP blocking on every hop
   - an egress proxy or network policy at the container level
   - per-user rate limits
6. **Human submission (product decision pending):** the worker's browser is remote, so the user can't take over its tab. The options are a live remote-browser view, a browser extension that replays decisions locally, or a desktop helper. The decision layer and report work unchanged with any of them.

## Deployment readiness checklist

- [ ] Supabase access; confirm the region and bucket (see `SUPABASE_INTEGRATION.md`)
- [ ] Apply `drizzle/0000_apply_workflow.sql`, then `supabase/apply-policies.sql`
- [ ] Set `REPO_DRIVER=postgres` and `STORAGE_DRIVER=s3` (production defaults; memory and file drivers are refused there)
- [ ] Add the new server env vars to `src/env.js` (coordinate with the team)
- [ ] Deploy the worker container with Chromium; set `WORKER_JOB_TIMEOUT_MS`
- [ ] Decide on the LLM: leave `LLM_PROVIDER` unset (rules only), or `anthropic` with a budgeted key
- [ ] Decide on the human-submission model (above)
- [ ] Before any real job site: ATS allowlist, SSRF controls, terms-of-service review, rate limits
- [ ] Monitoring: worker logs and job failure rate; alert when a submission reaches the form host (it should never happen)
