# Career Ops reuse audit

Career Ops (github.com/career-ops-hq/career-ops, MIT) is a **local, single-user CLI and Next.js app**:
- data lives in YAML and Markdown files in the user's checkout
- the LLM runs through the user's own agent CLI
- the browser is headed, on the user's machine

Aura Farmer extends the same ideas to a **hosted, multi-user** app. The table traces each path.

| Path | Career Ops implements | We reuse / adapt | We built independently | Duplication? | Change needed for hosting / multi-user / Jev |
|---|---|---|---|---|---|
| **Job discovery** | `scan.mjs` + about 150 providers (Greenhouse, Lever, Ashby, Workday, …) scanning whole boards; registry of employers | Endpoints for Greenhouse, Lever and Ashby from `providers/*.mjs`; private-IP ranges from `_ip-guard.mjs` | Single-posting import by URL with an allowlist, safe fetch and rate limit (`src/server/postings`) | Partial: we re-implemented 3 provider reads | **Scanning is not ported.** For discovery, port provider modules behind our safe fetch rather than rewriting them |
| **JD extraction** | Provider-specific parsing; `browser-extract.mjs` for JS pages; LLM structuring | – | Structural requirement extraction tuned on live postings (`src/lib/postings/extract.ts`) | Low | Deterministic so it is cheap per user |
| **CV ↔ job matching** | LLM evaluation (`modes/oferta.md` blocks A–G, holistic 1–5 score); deterministic `jd-skill-gap.mjs` + `skill-extract.mjs` | Block B method (requirement → evidence, inference never counts as a hard match) and `score-action` bands | Deterministic matcher with quoted evidence and blockers (`src/lib/match/match.ts`) | **Yes:** our ~40-skill lexicon duplicates `skill-extract.mjs` (441 lines, richer) | Port `skill-extract.mjs` instead of growing our lexicon. Optional LLM evaluation should reuse `oferta.md` as the prompt spec |
| **Resume tailoring** | `openai-tailor.mjs` (LLM rewrite); HTML/LaTeX templates with `generate-pdf.mjs` (Playwright) | The "verified facts only" principle | Reorder-only suggestions, `verifyNoNewFacts`, `pdf-lib` PDF (`src/lib/tailor`, `src/server/resume/pdf.ts`) | Partial: different renderer | `pdf-lib` works in serverless and the worker without a browser. Career Ops templates could be used for nicer output in the worker |
| **Application prep** | `prepare-application.mjs` field maps; web `answer-prompt.mjs`, `blank-unknown.mjs`, `handoff-gate.mjs` | Prompt-as-data approach; sensitive-question patterns | Draft answers from facts plus one reviewed template; saved answers feed autofill | Low | Answers stored per user in Postgres |
| **Autofill** | `web/src/lib/apply/*` (Playwright, extract, fill, verify, submit guard, agent drive loop). Local headed browser | `option-match` and `ai-directed-field` ported; classification patterns adapted | Hosted worker, rules → Jev → LLM tiers, combobox/multi-step/iframe/ARIA support, egress allowlist | **Yes (conceptually):** extract, fill and verify mirror Career Ops' structure | Hosted needs isolation (fresh context per job), a queue, leases and an egress allowlist; Career Ops assumes the user's own desktop. The Jev tier is new |
| **Submission handoff** | Brings the local headed window to front (`handoffSession`) | – | Browser extension and fill plan (`extension/`) | No | A remote browser can't be handed over; the extension fills the user's own tab |
| **Tracking** | Markdown tracker (`data/applications.md`), `set-status.mjs` | – | Application state machine plus job queue in Postgres | Conceptual | Multi-user needs a DB with ownership checks and RLS |

## Duplication inside Aura Farmer (after merging `main`)

1. **Two profile models:** the team's normalised `user_profile` / `experience` / `education` (`/profile`), and our JSON `candidate_profile` with parser provenance (`/apply/profile`).
2. **Two S3 implementations:** the team's hand-signed `src/server/storage/resume-storage.ts`, and our AWS-SDK `S3Storage` with memory/file drivers and an opt-in.
3. **Two resume download routes:** `/api/resumes/[id]` (team) and `/api/apply/resumes/[id]` (ours, through the storage driver).
4. **The early standalone `demo/`**, superseded by `/apply`.

## Recommended before merge (team decisions)

1. **Pick one profile source of truth.** Suggestion: keep the team's normalised tables as what the user edits. Our parser then pre-fills them, and the matching, tailoring and autofill code reads a `CandidateProfile` built from them (an adapter, not a rewrite).
2. **Pick one storage module.** Suggestion: our `ObjectStorage` interface, which gives memory/file drivers for tests and a dev opt-in, with the team's upload actions calling it.
3. **Retire `demo/` once `/apply` is accepted.**
4. **Port `skill-extract.mjs` from Career Ops** for matching instead of extending our lexicon.
