# Human submission handoff

**The problem:** the worker fills the form in an isolated browser. The user can't take over that tab to submit the real application. A screenshot or report is not a handoff.

| | A: live remote browser | **B: browser extension (chosen)** | C: desktop helper |
|---|---|---|---|
| Hackathon feasibility | Low (browser fleet, streaming, input relay) | High (small MV3 extension) | Medium (per-OS packaging) |
| UX | Laggy; user logs in to the ATS inside our browser | Native: their own browser, cookies, session | Install friction |
| Security/privacy | ATS credentials pass through our infra | Data only flows from our app into their tab | Local binary to trust |
| Deployment | Heavy, metered | None server-side | Signed builds per OS |
| Keeps filled state | While the session lives | Yes, it fills the tab they submit from | Yes |
| ATS compatibility | Bot detection on cloud IPs | Best (real user browser) | Good |

## How it works (proof of concept, implemented)

1. On a filled application ("Filled, awaiting your review"), the user clicks **Send to browser extension**. The page fetches `GET /api/applications/[id]/fill-plan` with its normal session. Server-side, the plan includes:
   - only fields that were filled *and read back*
   - approved drafts, flagged for review
   - a "needs your input" list
   - the tailored resume

   Safety-blocked values (EEO, consent, salary history, AI-directed questions) are never included. Plans expire after 30 minutes.
2. The page passes the plan to the extension. The content script `extension/bridge.js` runs only on the app origin and accepts messages only from the same window and origin. It relays the plan to `background.js`, which checks the sender URL again and stores it in `chrome.storage.session` (cleared when the browser closes).
3. On the employer's page, the user clicks the extension, then **Fill this page**. `filler.js`:
   - matches fields by their visible labels
   - sets values with native setters plus input and change events, so React forms register them
   - checks radios, picks select options, and attaches the resume (DataTransfer)
   - outlines filled fields green and drafts and needed fields amber, and shows a "review, then submit yourself" panel

   It **never clicks submit**.

**Install (dev):** in Chrome, open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and pick `extension/`. The manifest only matches `localhost` and `127.0.0.1` app origins. A production build must list the real app origin instead.

## Verified vs not

- **Verified** (`tests/apply/handoff.e2e.test.ts`). A plan built from a real worker run is applied to a fresh copy of each form in a plain browser:
  - **Full application:** values filled, resume attached, guarded fields left empty, needed fields highlighted, no submission.
  - **Greenhouse-style:** searchable yes/no dropdowns, filled by typing then clicking the unique safe match, never Enter.
  - **Ashby-style:** ARIA radio buttons, plus a display:none resume input.
  - **Browser-side verification:** after filling, every field is re-read. Anything not confirmed is reported, never assumed.
  - **A changed page:** answers with no matching field are reported ("had no matching field"), not guessed.
  - Expired plans are refused.
  - The unpacked extension loads in Chromium and stores a plan sent by the app page.
- **Not automated:** clicking the popup button. Chromium doesn't expose extension popups to tests; the popup injects the same `filler.js`.
- **Not tested** against real Greenhouse, Lever or Ashby pages (we never automate them).

## Before real users

1. **Production manifest:** list the deployed app origin in `content_scripts.matches` and `background.js` (today: localhost only). Keep `activeTab` + `scripting`; no broad host permissions.
2. **Distribution:** Chrome Web Store (unlisted) or an enterprise policy. Firefox needs an MV3 port.
3. **Real-ATS label quirks:** collect anonymised field labels from real postings (read-only) and add fixtures for any mismatch. Async-loaded option lists (for example, location search) may need longer waits.
4. **Privacy notice:** the plan holds the user's answers and resume for 30 minutes in session storage. Explain this and add a "clear" button.
5. **Usability test:** the popup shows filled, unconfirmed, needs-you and not-found counts; check users understand them.
