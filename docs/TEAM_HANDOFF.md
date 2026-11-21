# Team handoff: apply workflow (PR #5)

## Run the demo (about 10 minutes, synthetic data, no credentials)

```bash
npx pnpm@10.26.1 install && npx playwright install chromium
npx tsx scripts/dev/sample-resume.ts          # writes demo-resume.pdf (fictional person)
npx pnpm@10.26.1 dev:stack                    # PORT=3100 if 3000 is busy
```

1. Open http://localhost:54321/dev-login and sign in as the synthetic user (local mock auth).
2. **Resume upload:** `/apply/profile`, upload `demo-resume.pdf`.
3. **Profile review:** check the badges, set work rights (Australia: yes), sponsorship: no, then **Save**.
4. **Job import:** `/apply/jobs`, **Paste description**, paste `docs/demo/sample-job.txt`, then **Save job**. You can also try a public Greenhouse, Lever or Ashby link.
5. **Matching:** **Check my match**. Kubernetes shows as *Not in your profile*: never invented.
6. **Tailoring:** **Suggest tailoring**, accept the suggestions, edit and accept the draft answer, **Save decisions**, then **Generate tailored resume**.
7. **Autofill:** pick *Senior Software Engineer (Example Corp)*, then **Prepare and start autofill**. The worker fills the synthetic form.
8. **Human review:** grouped results, decision tier per field, screenshot and log. **Send to browser extension** hands the answers to the extension (load `extension/` unpacked) to fill the form in your own browser. You submit; then **Record as submitted**.

Run the checks with `pnpm test` (235+ tests), plus `SKIP_ENV_VALIDATION=1 pnpm typecheck && pnpm lint && pnpm build`. CI runs the same on every PR.

## What is real, mocked, pending

| | Status |
|---|---|
| Parsing, profile, matching, tailoring, PDF, autofill on synthetic forms, worker, queue, API, ownership checks | Working (tested) |
| Supabase Storage (S3) | Working with the team bucket (read-only check and one approved round trip). Opt-in outside production (`ALLOW_DEV_S3=1`) |
| Job import from Greenhouse, Lever, Ashby | Working (one live read each, then fixtures) |
| Supabase Auth | Our routes use the team's session code unchanged. Real-project sign-in has an opt-in live test that hasn't been run yet |
| Database migrations, RLS | Prepared and tested on PGlite. **Not applied** (`docs/STAGING_CHECKLIST.md`) |
| LLM tier (Claude) | Adapter built, tested with a fake HTTP layer. **No live calls** |
| Jev tier (TypeSafe) | Adapter built from the public docs. **No key, no live calls**. Benchmark uses an oracle upper bound |
| Browser extension handoff | Proof of concept. Localhost only; not distributed |
| Real ATS pages | Never automated. Extension handoff is the intended path |

## Decisions needed

1. Profile source of truth, and storage module (`docs/CAREER_OPS_REUSE.md`).
2. Migration path for staging: `db:push` or the migration files (`docs/STAGING_CHECKLIST.md`).
3. Whether middleware should return JSON 401 for `/api/*` (team auth code; not changed).
4. Worker hosting (container host with Chromium).
5. Extension distribution and production origin.
6. Budget for a live LLM/Jev benchmark.

## Career Ops reuse and Jev

- **Career Ops:** we port small, self-contained pieces (option matching, AI-directed question detection) and follow its evaluation method and provider endpoints. Its local-first runtime (files, agent CLI, desktop browser) is replaced with Postgres, a queue and an isolated worker. See `docs/CAREER_OPS_REUSE.md`.
- **Jev:** the aim is to cut LLM calls for **bounded choices** that rules can't settle, for example "Which best describes your primary focus?" answered from the candidate's skills. Rules are strengthened first, so Jev only sees genuinely ambiguous controls.
  - On our 11 synthetic forms, rules answer 54 of 56 expected fields.
  - A perfect Jev would add 2 (oracle upper bound).
  - Whether a real Jev is accurate and cheaper than the LLM needs a live, budgeted run. See `docs/APPLY_ENGINE.md` and `pnpm bench:apply`.
