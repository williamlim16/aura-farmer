# Resume → profile → autofill engine

Branch: `feat/apply-engine`. Runs entirely locally. Nothing here calls Supabase, a real job site, or a real LLM.

## Pipeline

```
upload (validate, store)  →  extract text (pdf/docx)  →  parse profile (deterministic)
        ↓
open form (Playwright) → extract fields → classify → decide (rules → Jev → LLM → guard)
        → fill → read back and verify → re-extract for new fields (≤3 rounds) → report
        → STOP (the user reviews and submits)
```

| Area | Files |
|---|---|
| Resume validation (shared by client and server) | `src/lib/resume/validate.ts` |
| Storage (S3/Supabase or memory) | `src/server/storage/*` |
| Upload logic and route | `src/server/resume/upload.ts`, `src/app/api/resume/upload/route.ts`, `src/app/resume/page.tsx` |
| Text extraction | `src/server/resume/extract-text.ts` (unpdf, mammoth) |
| Profile schema and parser | `src/lib/profile/schema.ts`, `src/lib/resume/parse-profile.ts` |
| Field classification | `src/lib/apply/classify.ts` |
| Decision layer | `src/lib/apply/decision/{rules,jev,llm,engine}.ts` |
| Browser | `src/server/apply/{extract-form,fill,verify,submit-guard,run}.ts` |

## Which browser actions need an LLM?

| Category | Examples | Handled by |
|---|---|---|
| **Deterministic** | Name, email, phone, links, resume upload, years-of-experience buckets, yes/no answers for stated preferences, saved answers to repeated questions | Rules: `autocomplete` attributes, input types, label patterns, safe option matching |
| **Ambiguous UI** | Unlabeled fields, odd option wording, picking from a long select list | Rules first. Then **Jev** (choose from given candidates, never invent). Then the LLM. |
| **Semantic reasoning** | "Why do you want to work here?", free-text questions | LLM. All of them go in one batched call. Always marked `reviewRequired`. |
| **Person only** | EEO/demographics, criminal history, salary history, consent/attestation boxes, questions addressed to an AI, referrer/reference details, anything the profile doesn't state | The **guard**. These are never sent to any provider and never filled. |

Safety properties, each covered by tests:

- Sensitive fields never reach the LLM prompt.
- The guard overrides any tier, including an LLM that returns a value anyway.
- An LLM answer for a select or radio must match an option exactly. Otherwise the field goes to the person.
- Each run has a call budget (`maxCallsPerRun`).
- An LLM outage or malformed output sends fields to the person. Rule-based fills still land.
- **Stop-before-submit has three layers**:
  - an in-page block on submit events, `form.submit()` and `requestSubmit()`
  - a network block on non-GET navigations and XHR/fetch requests
  - a fill step that never clicks buttons or presses Enter

  The `trap.html` fixture tries all three submit routes, and the test server confirms no POST arrived.

**Jev** (TypeSafe's System One model, researched 2026-11-21 from docs.typesafe.ai):
- **What it is:** a hosted API (`POST /v1/systemone`). Its `choice` primitive returns the chosen option, per-option probabilities and a confidence score, for up to 255 options, with all questions answered in one call. That fits "select from a constrained candidate set".
- **What's built:** `src/server/llm/typesafe-jev.ts` follows the documented shapes and is tested against a fake `fetch`.
- **Not validated:** it hasn't run against the real API, because there's no key. Access is described as early access, and pricing is only on the vendor homepage.
- **Benchmark finding:** on our current forms the rules already resolve every bounded-option field, so a Jev tier decided 0 fields. It needs harder option-matching cases before its value can be judged.
- **Reference:** the third-party `jev-browser` (MIT, single maintainer) uses the same pattern for picking browser actions.

## Tests (`pnpm test`, 89 tests incl. connected workflow — see LOCAL_DEMO.md)

| Suite | Kind | What it covers |
|---|---|---|
| `tests/resume/upload.test.ts` | unit, memory storage | Validation, content sniffing, auth, storage error mapping, env handling |
| `tests/resume/parse.test.ts` | unit, real generated PDF and DOCX | Text extraction and profile parsing, missing-field reporting |
| `tests/apply/decision.test.ts` | unit | Classifier, option matching, AI-directed questions, tier ordering, budget, guard |
| `tests/apply/autofill.e2e.test.ts` | headless Chromium plus local fixture server; **LLM mocked** | Basic, ambiguous, dynamic and trap forms; outage recovery; invalid LLM options |

## Benchmark (`pnpm bench:apply`): see the latest `bench-results/*.json`; the table below is from the first version

Rules tier vs. rules plus a **scripted mock** LLM, run on the four synthetic forms (median of 3 runs):

| Form | Fields | Rules only: verified / needs person | + mock LLM: verified / needs person | Model calls | Form posted |
|---|---|---|---|---|---|
| basic | 9 | 9 / 0 | 9 / 0 | 0 | no |
| ambiguous | 14 | 7 / 7 | 9 / 5 | 1 | no |
| dynamic | 3 | 3 / 0 | 3 / 0 | 0 | no |
| trap | 2 | 2 / 0 | 2 / 0 | 0 | no (3 attempts blocked) |

On the ambiguous form, required completion is 75% because the required consent checkbox is always left for the person.

What's real and what isn't: fill accuracy, completion and call counts were measured. Token counts are estimates of about 4 characters per token. Latency covers the browser only, with no real model time. **No real-model latency or cost has been measured yet.** To measure it, implement `LlmClient` for the chosen provider and pass `pricing`.

## Reused from Career Ops (MIT, notices kept in the files)

- `option-match.ts`: ported.
- `ai-directed.ts`: patterns ported verbatim.
- `classify.ts`: sensitive-question patterns adapted from `blank-unknown.mjs`.

Used as reference only: `extract.ts`, `submit-guard.mjs`, `answer-prompt.mjs` and `handoff-gate.mjs` in `career-ops/web/src/lib/apply/`. Don't use the "career-ops" name in product branding (see their `TRADEMARK.md`).

## Known gaps / next steps

1. A real `LlmClient` (Claude or other) and a measured benchmark with real latency and cost.
2. Multi-step forms (Next → page 2). Today it fills one page per run and never clicks Next.
3. Custom comboboxes (react-select, Greenhouse, Ashby): only native `<select>` and radios are handled. Port `fillSession`'s combobox logic from Career Ops.
4. Iframe-embedded forms (e.g. Greenhouse embeds): `extractForm` accepts a `Frame`, but frame selection isn't wired up.
5. Running against a hosted service needs SSRF and egress controls, and a sandboxed browser worker (see Career Ops `url-guard.mjs`).
6. A review UI showing the report, plus persistence (see `SUPABASE_INTEGRATION.md`).
7. The resume parser assumes single-column layouts. For low-confidence fields, use the LLM only for entries in `missing`.
