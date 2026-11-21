import type { BrowserContext, Page } from "playwright";

import { NAME_SHIM } from "./page-shim";

/**
 * Stop-before-submit, enforced in three independent layers so one bug cannot
 * submit a real application:
 *  1. In-page: block form submit events, form.submit(), form.requestSubmit().
 *  2. Network: abort any non-GET navigation/document/XHR/fetch request
 *     (programmatic submissions).
 *  3. The fill step never clicks buttons and never presses Enter (see fill.ts).
 * Blocked attempts are counted and reported, never silently swallowed.
 */
export interface SubmitGuard {
  blockedNetwork: { method: string; url: string; resourceType: string }[];
  blockedInPage(page: Page): Promise<number>;
  /**
   * Lift the guard for an explicitly approved submission (user-confirmed, after
   * re-verification). Only the confirmed-submit path calls this.
   */
  release(page: Page): Promise<void>;
}

export interface SubmitGuardOptions {
  /**
   * Let non-navigation XHR/fetch POSTs through (e.g. an ATS uploading the
   * resume to storage while filling). Document/navigation submissions and
   * in-page form submits stay blocked until release(). Default false.
   */
  allowBackgroundWrites?: boolean;
  /**
   * Narrow exception: background (xhr/fetch) writes that this predicate
   * accepts, e.g. an ATS's own resume-upload to its storage bucket. Never
   * applies to navigations or form submissions.
   */
  allowBackgroundWrite?: (req: { method: string; url: string; resourceType: string; contentType: string }) => boolean;
}

// A plain string, not a function: bundler transforms (e.g. __name wrappers)
// must never be able to break the guard inside the page.
const IN_PAGE_GUARD = `
(() => {
  window.__afBlocked = 0;
  var origSubmit = HTMLFormElement.prototype.submit;
  var origRequestSubmit = HTMLFormElement.prototype.requestSubmit;
  function allowed() { return window.__afReleased === true; }
  function block(e) {
    window.__afBlocked = (window.__afBlocked || 0) + 1;
    if (e) { e.preventDefault(); e.stopImmediatePropagation(); }
  }
  window.addEventListener("submit", function (e) { if (!allowed()) block(e); }, true);
  HTMLFormElement.prototype.submit = function () { if (allowed()) return origSubmit.call(this); block(); };
  HTMLFormElement.prototype.requestSubmit = function (s) { if (allowed()) return origRequestSubmit.call(this, s); block(); };
})();
`;

export async function installSubmitGuard(context: BrowserContext, opts: SubmitGuardOptions = {}): Promise<SubmitGuard> {
  const blockedNetwork: SubmitGuard["blockedNetwork"] = [];
  let released = false;
  await context.addInitScript({ content: NAME_SHIM + IN_PAGE_GUARD });
  await context.route("**/*", async (route) => {
    const req = route.request();
    const method = req.method();
    const type = req.resourceType();
    const isBeacon = type === "ping" || type === "beacon";
    const write = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
    const navigation = req.isNavigationRequest() || type === "document";
    const background = type === "xhr" || type === "fetch";
    const uploadOk = background && !!opts.allowBackgroundWrite?.({ method, url: req.url(), resourceType: type, contentType: req.headers()["content-type"] ?? "" });
    const blocked = isBeacon || (write && (navigation || (background && !opts.allowBackgroundWrites && !uploadOk)));
    if (!released && blocked) {
      blockedNetwork.push({ method, url: req.url(), resourceType: type });
      await route.abort("blockedbyclient");
      return;
    }
    await route.fallback(); // chain to other handlers (e.g. an egress allowlist)
  });
  return {
    blockedNetwork,
    blockedInPage: async (page) =>
      page.evaluate("window.__afBlocked || 0").then((n) => Number(n)).catch(() => -1),
    release: async (page) => {
      released = true;
      for (const f of page.frames()) await f.evaluate("window.__afReleased = true").catch(() => undefined);
    },
  };
}
