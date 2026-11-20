# Local setup and demo

Everything runs locally with synthetic data. No Docker, Supabase access, or paid API is needed.

```bash
npx pnpm@10.26.1 install
npx playwright install chromium
npx pnpm@10.26.1 dev:stack          # PORT=3100 if 3000 is taken
```

`dev:stack` starts four pieces:

| Piece | Where | What |
|---|---|---|
| Dev database | 127.0.0.1:54329 | PGlite (real Postgres in WASM), persisted in `.data/pglite`, migrations applied at start |
| Mock auth | http://localhost:54321 | A local stand-in for Supabase Auth. The team's unmodified middleware verifies its ES256 tokens through JWKS. Dev and test only. |
| Web app | http://localhost:3000 | The team's Next.js app (`next dev`) with the integrated `/apply` workflow |
| Worker | separate process | Claims jobs and runs Playwright against the local test forms |

Then:

1. Open **http://localhost:54321/dev-login** and pick a synthetic user.
2. On **/apply/profile**, upload a resume, then check and correct the extracted profile. Set your work rights, sponsorship and salary there.
3. On **/apply/new**, pick a test job (optionally with the mock LLM) and choose "Prepare and start autofill".
4. Watch the status and logs, then review the grouped fields, decision tiers and screenshot. When done, record it as submitted (only after confirming you did it yourself).

A synthetic resume: `npx tsx -e "import('./tests/helpers/resume-fixtures.ts').then(async m=>require('fs').writeFileSync('synthetic-cv.pdf', await m.makePdf()))"`. You can also use the download link in the older standalone demo (`pnpm demo`, port 4317), which is still available but superseded by the integrated app.

## Why mock auth is safe

- It's a separate script under `scripts/dev/` that no app code imports.
- It refuses `NODE_ENV=production` and binds to 127.0.0.1.
- It only takes effect when the app process is started with `NEXT_PUBLIC_SUPABASE_URL` pointing at it.
- Its signing key is generated fresh each run, so a deployed app (pointing at real Supabase) can never accept its tokens.

## Commands

| Command | What |
|---|---|
| `pnpm test` | All tests (~25 s): unit, contract (memory + PGlite), worker, and Next.js end to end |
| `pnpm test:e2e` | Browser and end-to-end suites only |
| `pnpm bench:apply` | Rules vs rules+LLM vs rules+Jev+LLM on 7 synthetic forms (mock tiers, labelled) |
| `pnpm worker` | Worker process (needs `REPO_DRIVER=postgres`, `DATABASE_URL`, `STORAGE_DRIVER=file\|s3`) |
| `pnpm dev:db` | Dev database only |
| `pnpm typecheck`, `pnpm lint`, `pnpm build` | As usual (`SKIP_ENV_VALIDATION=1` if no `.env`) |

## Environment variables (placeholders only)

| Variable | Default | Notes |
|---|---|---|
| `REPO_DRIVER` | `memory` (dev), `postgres` (prod) | Memory is refused in production |
| `STORAGE_DRIVER` | `memory` (dev), `s3` (prod) | `file` for local multi-process work; memory and file refused in production |
| `FILE_STORAGE_DIR` | `.data/storage` | Dev only |
| `BUCKET_S3_ENDPOINT` / `BUCKET_REGION` / `BUCKET_NAME` / `BUCKET_ACCESS_KEY` / `BUCKET_SECRET_KEY` | none | S3 storage; secrets are server-only |
| `LLM_PROVIDER` | unset (rules only) | `mock` (dev only) or `anthropic` |
| `LLM_ALLOW_PAID_CALLS` / `APPLY_LLM_API_KEY` | none | Both required for `anthropic`; a generic `ANTHROPIC_API_KEY` is ignored on purpose |
| `LLM_MODEL` / `LLM_EFFORT` / `LLM_TIMEOUT_MS` / `LLM_MAX_CALLS_PER_RUN` | `claude-opus-5-5` / `low` / 30000 / 2 | |
| `JEV_PROVIDER` / `JEV_ALLOW_PAID_CALLS` / `APPLY_JEV_API_KEY` / `JEV_MODEL` | unset | `typesafe` enables the Jev tier |
| `WORKER_JOB_TIMEOUT_MS` / `WORKER_HEADED` | 90000 / unset | `WORKER_HEADED=1` shows the worker's browser locally |
