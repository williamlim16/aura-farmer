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

- **Verified** (`tests/apply/handoff.e2e.test.ts`):
  - A plan built from a real worker run is applied to a fresh copy of the form in a plain browser. The right values are filled, the resume is attached, guarded fields stay empty, needed fields are highlighted, and no submission reaches the server.
  - Expired plans are refused.
  - The unpacked extension loads in Chromium, and its bridge stores a plan sent by the app page.
- **Not automated:** clicking the popup button. Chromium doesn't expose extension popups to tests; the same `filler.js` is what the popup injects.
- **Not tested** against real Greenhouse, Lever or Ashby pages (we never automate them). Label matching assumes the real form uses the same labels as the run that produced the plan. Fields not found are reported in the popup.
- **To do for real ATS forms:** react-select comboboxes in `filler.js`, per-ATS label quirks, a production manifest (`host_permissions` for the app origin), and a store listing or enterprise distribution.
