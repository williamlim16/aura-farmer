# Local end-to-end demo

```bash
npx pnpm@10.26.1 install           # once
npx playwright install chromium    # once
npx pnpm@10.26.1 demo              # → http://127.0.0.1:4317
```

Workflow:

1. **Upload** a PDF or DOCX. Download the synthetic sample from the page if you need one.
2. **Review the profile.** Each value shows where it came from (`parsed 95%`, `you`, `not found`). Fix mistakes and set application preferences: work rights, sponsorship, salary and so on. These are never guessed from the resume.
3. **Choose a local test form.** Pick rules only, or rules plus a **mock** LLM. Optionally tick "show the browser window" to watch Chromium fill the form. The window stays open and submitting is still blocked.
4. **Review the application.** Every field shows what it was detected as, which tier decided it (Rules / Jev / LLM / Safety guard), and the result (Filled ✓ / Needs you / Error / Mismatch / Skipped) with the value or reason. You can filter the table. There's also a screenshot and the raw JSON report.

## Isolation

| Risk | Control |
|---|---|
| Shipping to production | The code lives in `demo/`, outside `src/app`, so it isn't in the Next build. `pnpm demo` refuses to start when `NODE_ENV=production`. |
| Real user data | Synthetic sample resume. `MemoryStorage` and in-process state only, cleared on restart or "Start over". No Supabase, and no env vars or secrets read. |
| Network exposure | Binds to `127.0.0.1` only. Rejects foreign `Host` headers (DNS rebinding) and cross-origin POST/PUT. Strict CSP. All data is rendered with `textContent`. |
| Real job sites | Only allow-listed forms from `demo/forms` and `tests/fixtures/forms`. A browser-level egress allowlist aborts any request to another origin (tested with an outbound-request probe page). |
| Auto-submission | The engine has no submit code path. A three-layer submit guard runs on top of that. The fixture endpoint `/submit` counts anything that gets through, and the UI shows a warning if that count is above 0. |

## Tests

Run all 89 with `pnpm test`.

The connected-workflow tests are in `tests/workflow/`:

- `demo.e2e.test.ts` drives the demo's real HTTP API: upload → extract → parse → review edits → Decision Engine → Playwright autofill → report. It covers PDF and DOCX, rules only and mock LLM, and the dynamic and trap forms, plus isolation checks (host, origin, form allowlist, egress, loopback).
- The same file has a real-browser test that clicks through the UI.
- `review.test.ts` covers profile review merge and validation.

**Mocked:** storage (memory) and the LLM tier (`demo/mock-llm.ts`, scripted, no network). **Real:** PDF/DOCX parsing, Chromium, the DOM, the network blocking.

## What's left before this runs in the hosted app

Ordered roughly by dependency.

1. **Next.js routes behind Supabase auth.** The workflow functions are framework-free, so each route is thin.
   - `POST /api/resume/upload` should call `ingestResume` (today it calls `handleResumeUpload` only).
   - Add `GET`/`PUT /api/profile` (using `toReview` / `applyReview`) and `POST /api/applications` (using `runApplication`).
   - Port the demo's review UI to shadcn pages. `demo/public/app.js` maps directly onto React components.
2. **Persistence** (needs Supabase access; schema proposal in `SUPABASE_INTEGRATION.md`): `resumes`, `candidate_profiles` (the profile as JSON, validated by `candidateProfileSchema`) and `applications` (report JSON; screenshot in storage).
3. **Where the browser runs.** Playwright doesn't fit in Vercel serverless functions. It needs a separate worker (a container on Fly, Railway or Render, or a hosted browser such as Browserless or Browserbase) fed by a job queue: a Supabase table, pg-boss or Inngest. `runApplication` is already the worker's entry point.
4. **Human review and submission when hosted. This is a product decision.** A remote headless browser can't hand its tab to the user. The options:
   - **(a)** A live remote-browser view (Browserbase-style) where the user reviews and clicks Submit.
   - **(b)** A browser extension that fills the form in the user's own browser from the server's decisions.
   - **(c)** A desktop helper.

   The decision layer and report work unchanged for all three. Only fill/handoff differs.
5. **Real job-site access.**
   - Replace the loopback allowlist with an ATS host allowlist (Greenhouse, Lever, Ashby), plus SSRF protection: block private IPs and re-check every redirect. Career Ops' `url-guard.mjs` and `egress-proxy.mjs` are references.
   - Add per-user rate limits.
   - Review each job site's terms of service.
6. **ATS coverage** (still not done from the last round): custom comboboxes (react-select), multi-step forms ("Next"), and iframe-embedded forms (Greenhouse embeds).
7. **A real LLM client**, with per-user call and cost caps and a measured benchmark. Send only the minimal profile slice (already done in `buildLlmUserPrompt`), and add a privacy notice and consent for sending resume data to a model provider.
8. **Recording results.** After the user submits, record `submitted_by_user` with a timestamp and the final reviewed answers. Never infer submission.
9. **Jev**: a client implementation, once we know what it is (the adapter is in place).
