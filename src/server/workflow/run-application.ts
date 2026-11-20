/**
 * Run the existing Decision Engine + Playwright autofill against one form URL
 * for one reviewed profile. Never submits (runAutofill has no submit path and
 * the submit guard blocks page-initiated submissions).
 *
 * `allowedOrigins` is an egress allowlist enforced at the browser-context
 * level: any request to another origin is aborted. The local demo passes only
 * its own loopback origin, so no real job site can be reached.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium, type Browser, type BrowserContext } from "playwright";

import { DecisionEngine } from "~/lib/apply/decision/engine";
import type { DecisionProvider } from "~/lib/apply/decision/types";
import type { CandidateProfile } from "~/lib/profile/schema";
import type { ResumeKind } from "~/lib/resume/validate";
import { runAutofill, type AutofillReport } from "~/server/apply/run";
import { installSubmitGuard } from "~/server/apply/submit-guard";

export interface RunApplicationInput {
  formUrl: string;
  profile: CandidateProfile;
  resume: { bytes: Uint8Array; kind: ResumeKind; filename: string } | null;
  providers: DecisionProvider[];
  allowedOrigins: string[];
  job?: { title?: string; company?: string };
  /** Reuse a browser (tests, demo). Otherwise one is launched and closed. */
  browser?: Browser;
  headed?: boolean;
  /** Keep the context open (headed demo) instead of closing it. Caller must close. */
  keepOpen?: boolean;
  /** Abort (cancel/timeout): closes the browser context so in-flight steps fail fast. */
  signal?: AbortSignal;
  /** Page console errors and failed requests, for execution logs. */
  onEvent?: (level: "info" | "warn", message: string) => void;
}

export class RunAbortedError extends Error {
  constructor(readonly reason: string) {
    super(`Run aborted: ${reason}`);
    this.name = "RunAbortedError";
  }
}

export interface RunApplicationResult {
  report: AutofillReport;
  screenshotPng: Buffer;
  blockedEgress: string[];
  context?: BrowserContext;
}

function safeFilename(name: string, kind: ResumeKind) {
  const base = path.basename(name).replace(/[^A-Za-z0-9._-]/g, "_").replace(/\.(pdf|docx)$/i, "").slice(0, 60) || "resume";
  return `${base}.${kind}`;
}

export async function runApplication(input: RunApplicationInput): Promise<RunApplicationResult> {
  if (input.signal?.aborted) throw new RunAbortedError(String(input.signal.reason ?? "aborted"));
  const target = new URL(input.formUrl);
  const allowed = new Set(input.allowedOrigins.map((o) => new URL(o).origin));
  if (!allowed.has(target.origin)) throw new Error(`Form origin ${target.origin} is not allowed.`);

  const ownsBrowser = !input.browser;
  const browser = input.browser ?? (await chromium.launch({ headless: !input.headed }));
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "af-run-"));
  let context: BrowserContext | undefined;
  try {
    let resumePath: string | null = null;
    if (input.resume) {
      resumePath = path.join(tmp, safeFilename(input.resume.filename, input.resume.kind));
      await fs.writeFile(resumePath, input.resume.bytes);
    }

    context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const ctx = context;
    const onAbort = () => void ctx.close().catch(() => undefined);
    input.signal?.addEventListener("abort", onAbort, { once: true });
    const blockedEgress: string[] = [];
    // Egress allowlist first, then the submit guard (its route is checked first by Playwright: last registered wins).
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      let origin = "";
      try {
        origin = new URL(url).origin;
      } catch {
        /* data:, about: etc. */
      }
      if (origin && !allowed.has(origin) && !url.startsWith("data:")) {
        blockedEgress.push(url.slice(0, 200));
        await route.abort("blockedbyclient");
        return;
      }
      await route.fallback();
    });
    const guard = await installSubmitGuard(context);
    const page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") input.onEvent?.("warn", `Page console error: ${m.text().slice(0, 200)}`);
    });
    page.on("pageerror", (e) => input.onEvent?.("warn", `Page script error: ${e.message.slice(0, 200)}`));
    await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 15_000 });

    const engine = new DecisionEngine(input.providers);
    const report = await runAutofill(page, engine, { profile: input.profile, hasResume: !!input.resume, job: input.job }, { resumePath, guard });
    const screenshotPng = await page.screenshot({ fullPage: true });
    if (input.signal?.aborted) throw new RunAbortedError(String(input.signal.reason ?? "aborted"));

    if (input.keepOpen) return { report, screenshotPng, blockedEgress, context };
    return { report, screenshotPng, blockedEgress };
  } catch (e) {
    if (input.signal?.aborted) throw new RunAbortedError(String(input.signal.reason ?? "aborted"));
    throw e;
  } finally {
    if (!input.keepOpen) await context?.close().catch(() => undefined);
    if (ownsBrowser && !input.keepOpen) await browser.close().catch(() => undefined);
    // The headed window may still need the file for re-upload; remove it only when closing.
    if (!input.keepOpen) await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}
