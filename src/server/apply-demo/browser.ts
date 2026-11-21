/**
 * Browser launch for the hosted Apply Demo.
 *
 * On Vercel Functions (Amazon Linux, no system Chromium) we use the
 * serverless Chromium build from @sparticuz/chromium, driven by the same
 * Playwright API the engine already uses. Locally, Playwright's own Chromium.
 */
import type { Browser } from "playwright";

export interface LaunchedBrowser {
  browser: Browser;
  runtime: "vercel-function-sparticuz" | "local-playwright";
  chromiumVersion: string;
}

export async function launchDemoBrowser(): Promise<LaunchedBrowser> {
  const { chromium } = await import("playwright");
  if (process.env.VERCEL && process.platform === "linux") {
    const sparticuz = (await import("@sparticuz/chromium")).default;
    const browser = await chromium.launch({
      executablePath: await sparticuz.executablePath(),
      args: sparticuz.args,
      headless: true,
    });
    return { browser, runtime: "vercel-function-sparticuz", chromiumVersion: browser.version() };
  }
  const browser = await chromium.launch({ headless: true });
  return { browser, runtime: "local-playwright", chromiumVersion: browser.version() };
}
