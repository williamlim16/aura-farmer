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
}

// A plain string, not a function: bundler transforms (e.g. __name wrappers)
// must never be able to break the guard inside the page.
const IN_PAGE_GUARD = `
(() => {
  window.__afBlocked = 0;
  function block(e) {
    window.__afBlocked = (window.__afBlocked || 0) + 1;
    if (e) { e.preventDefault(); e.stopImmediatePropagation(); }
  }
  window.addEventListener("submit", block, true);
  HTMLFormElement.prototype.submit = function () { block(); };
  HTMLFormElement.prototype.requestSubmit = function () { block(); };
})();
`;

export async function installSubmitGuard(context: BrowserContext): Promise<SubmitGuard> {
  const blockedNetwork: SubmitGuard["blockedNetwork"] = [];
  await context.addInitScript({ content: NAME_SHIM + IN_PAGE_GUARD });
  await context.route("**/*", async (route) => {
    const req = route.request();
    const method = req.method();
    const type = req.resourceType();
    const isBeacon = type === "ping" || type === "beacon";
    if (isBeacon || (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && (req.isNavigationRequest() || type === "document" || type === "xhr" || type === "fetch"))) {
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
  };
}
