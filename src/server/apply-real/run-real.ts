/**
 * Real ATS application (Greenhouse / Lever) in cloud Chromium.
 *
 * review(): open the real application page, fill it with the existing engine
 *   (rules -> Jev -> LLM -> safety guard; explicit user answers allowed), read
 *   every field back, screenshot. The submit guard is strict: nothing is sent.
 * submit(): only with a valid review token for the same inputs. Re-fills the
 *   same page, requires every reviewed value to read back identically and
 *   every required field to be verified, then releases the guard, clicks the
 *   form's submit button once, and looks for the employer's confirmation.
 *   Outcome is "confirmed" only on a positive confirmation signal.
 */
import type { Page, Response } from "playwright";

import { RuleProvider } from "~/lib/apply/decision/rules";
import type { DecisionProvider } from "~/lib/apply/decision/types";
import type { CandidateProfile } from "~/lib/profile/schema";
import type { ResumeKind } from "~/lib/resume/validate";
import type { AutofillReport } from "~/server/apply/run";
import { ALWAYS_HUMAN_KINDS } from "~/lib/apply/types";
import { suggestOptions } from "~/lib/apply/suggest-options";
import type { LlmClient } from "~/lib/apply/decision/llm";
import { createJevProviders, createLlmClient, createLlmProviders } from "~/server/llm/factory";
import { runApplication } from "~/server/workflow/run-application";
import { launchBrowser } from "./browser";
import { assertPublicHost, type ResolvedApplication } from "./resolve";
import { fieldKey, type ReviewedField, type ReviewState } from "./state";

export interface RealRunInput {
  app: ResolvedApplication;
  profile: CandidateProfile;
  resume: { bytes: Uint8Array; kind: ResumeKind; filename: string };
}

export interface RunEvidence {
  runtime: { executor: string; chromiumVersion: string; region: string | null; durationMs: number; providers: string[] };
  report: AutofillReport;
  blockedEgress: string[];
  screenshotJpegBase64: string;
  events: string[];
}

function providers(events: string[]): DecisionProvider[] {
  const list: DecisionProvider[] = [new RuleProvider()];
  for (const [name, make] of [["Jev", createJevProviders], ["LLM", createLlmProviders]] as const) {
    try {
      list.push(...make(process.env));
    } catch (e) {
      events.push(`${name} tier not enabled (${e instanceof Error ? e.message : String(e)}).`);
    }
  }
  return list;
}

/** Browser egress: https only, to hosts that resolve to public addresses (checked once per host). */
function egressPolicy() {
  const cache = new Map<string, Promise<boolean>>();
  return async (raw: string) => {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return false;
    }
    if (u.protocol !== "https:" && u.protocol !== "wss:") return false;
    let p = cache.get(u.hostname);
    if (!p) {
      p = assertPublicHost(u.hostname).then(() => true, () => false);
      cache.set(u.hostname, p);
    }
    return p;
  };
}

/** Greenhouse attaches a resume by POSTing multipart data to its own S3 bucket (grnhse-*.s3[.<region>].amazonaws.com). */
export function isAtsResumeUpload(req: { method: string; url: string; resourceType: string; contentType: string }): boolean {
  if (req.method !== "POST" || req.resourceType !== "xhr" || !req.contentType.toLowerCase().startsWith("multipart/form-data")) return false;
  try {
    const u = new URL(req.url);
    return u.protocol === "https:" && /^grnhse-[a-z0-9-]+\.s3(\.[a-z0-9-]+)?\.amazonaws\.com$/.test(u.hostname) && u.pathname === "/";
  } catch {
    return false;
  }
}

export function reviewedFields(report: AutofillReport): ReviewedField[] {
  return report.fields.map((f) => ({ step: f.step, label: f.label || f.id, outcome: f.outcome, value: f.value === undefined ? "" : String(f.value), required: f.required }));
}

async function open(input: RealRunInput, events: string[]) {
  const t0 = Date.now();
  const launched = await launchBrowser();
  events.push(`Browser launched: Chromium ${launched.chromiumVersion} (${launched.runtime}) in ${Date.now() - t0} ms.`);
  const provs = providers(events);
  const origin = new URL(input.app.applyUrl).origin;
  try {
    const result = await runApplication({
      formUrl: input.app.applyUrl,
      profile: input.profile,
      resume: input.resume,
      providers: provs,
      allowedOrigins: [origin],
      egress: egressPolicy(),
      browser: launched.browser,
      keepOpen: true,
      // Form submission is blocked in both modes (until the guard is released
      // for the single approved click). The only background write allowed is
      // the ATS's own resume upload to its storage bucket, which is what
      // attaching a file does in any browser; it creates no application.
      guard: { allowBackgroundWrite: isAtsResumeUpload },
      screenshot: { type: "jpeg", quality: 55 },
      waitForIdleMs: 8_000,
      onEvent: (level, m) => void events.push(`${level}: ${m}`),
    });
    return { result, launched, provs, t0 };
  } catch (e) {
    await launched.browser.close().catch(() => undefined);
    throw e;
  }
}

function evidence(o: Awaited<ReturnType<typeof open>>, events: string[], screenshot: Buffer): RunEvidence {
  for (const b of o.result.guard?.blockedNetwork ?? []) events.push(`guard blocked: ${b.method} ${b.resourceType} ${new URL(b.url).host}${new URL(b.url).pathname}`.slice(0, 200));
  return {
    runtime: { executor: o.launched.runtime, chromiumVersion: o.launched.chromiumVersion, region: process.env.VERCEL_REGION ?? null, durationMs: Date.now() - o.t0, providers: o.provs.map((p) => p.name) },
    report: o.result.report,
    blockedEgress: [...new Set(o.result.blockedEgress)].slice(0, 40),
    screenshotJpegBase64: screenshot.toString("base64"),
    events,
  };
}

/**
 * For answers the rules could not apply (not an exact option, or ambiguous), ask the LLM, if one is
 * configured, to choose among the form's REAL options. Suggestions only: the person confirms. EEO,
 * legal and consent questions are never sent to a model.
 */
export async function addAiSuggestions(report: AutofillReport, events: string[], client: LlmClient | null | undefined = undefined): Promise<void> {
  let llm: LlmClient | null;
  try {
    llm = client === undefined ? createLlmClient(process.env) : client;
  } catch (e) {
    events.push(`AI option suggestions not enabled (${e instanceof Error ? e.message : String(e)}).`);
    return;
  }
  const items = report.fields
    .filter((f) => f.outcome === "needs_human" && f.answer && f.options?.length && !ALWAYS_HUMAN_KINDS.has(f.kind as never) && f.suggestions?.length !== 1)
    .map((f) => ({ f, q: { id: f.id, question: f.label, answer: f.answer!, options: f.options! } }));
  if (!items.length) return;
  if (!llm) {
    events.push(`AI option suggestions are off (no LLM configured); ${items.length} answer(s) were matched by rules only.`);
    return;
  }
  try {
    const got = await suggestOptions(llm, items.map((i) => i.q));
    for (const { f } of items) {
      const g = got.get(f.id);
      if (g) {
        f.suggestions = [g.option, ...(f.suggestions ?? []).filter((x) => x !== g.option)];
        f.suggestedBy = "ai";
      }
    }
    events.push(`AI option suggestions: ${got.size} of ${items.length} answer(s) matched to a real option (confirmation required).`);
  } catch (e) {
    events.push(`AI option suggestions failed (${e instanceof Error ? e.message.split("\n")[0] : "error"}); rules only.`);
  }
}

export async function reviewApplication(input: RealRunInput, llm?: LlmClient | null): Promise<RunEvidence> {
  const events: string[] = [`Application page: ${input.app.applyUrl} (${input.app.ats}, ${input.app.via}).`];
  const o = await open(input, events);
  try {
    await addAiSuggestions(o.result.report, events, llm);
    const captcha = await detectCaptcha(o.result.page!);
    if (captcha) events.push(`Note: the page uses ${captcha}. It may challenge or reject an automated submission.`);
    return evidence(o, events, o.result.screenshotPng);
  } finally {
    await o.launched.browser.close().catch(() => undefined);
  }
}

async function detectCaptcha(page: Page): Promise<string | null> {
  const srcs = page.frames().map((f) => f.url());
  if (srcs.some((s) => /recaptcha\/(enterprise|api2)\/bframe/.test(s))) return "a reCAPTCHA challenge";
  if (srcs.some((s) => s.includes("recaptcha"))) return "reCAPTCHA (invisible/score-based)";
  if (srcs.some((s) => s.includes("hcaptcha.com"))) return "hCaptcha";
  if (srcs.some((s) => s.includes("challenges.cloudflare.com"))) return "Cloudflare Turnstile";
  return null;
}

/** Visible challenge after clicking submit (image puzzle etc.). */
async function visibleChallenge(page: Page): Promise<boolean> {
  for (const f of page.frames()) {
    if (!/recaptcha\/(enterprise|api2)\/bframe|hcaptcha\.com\/captcha|challenges\.cloudflare\.com/.test(f.url())) continue;
    const el = await f.frameElement().catch(() => null);
    const box = el ? await el.boundingBox().catch(() => null) : null;
    if (box && box.width > 100 && box.height > 100) return true;
  }
  return false;
}

export type SubmitOutcome =
  | { status: "confirmed"; confirmation: string; finalUrl: string }
  | { status: "not_submitted"; reason: string; differences?: string[] }
  | { status: "blocked"; reason: string; finalUrl: string }
  | { status: "uncertain"; reason: string; finalUrl: string };

const CONFIRM_TEXT = /(thank you for (applying|your application|your interest)|application (has been |was )?(received|submitted)|we('ve| have) received your application|application submitted)/i;
const CONFIRM_URL = /\/(confirmation|thanks|thank-you|thank_you|application_confirmation)\b/i;

async function findSubmitButton(page: Page) {
  const candidates = page.locator('form button[type="submit"], form input[type="submit"], button#btn-submit, button[data-qa="btn-submit"]');
  const n = await candidates.count();
  const visible = [];
  for (let i = 0; i < n; i++) {
    const c = candidates.nth(i);
    if (!(await c.isVisible().catch(() => false))) continue;
    const text = ((await c.textContent().catch(() => "")) ?? "") + ((await c.getAttribute("value").catch(() => "")) ?? "");
    if (/submit|send application|apply/i.test(text)) visible.push({ c, text: text.trim() });
  }
  return visible;
}

export async function submitApplication(input: RealRunInput, reviewed: ReviewState): Promise<RunEvidence & { outcome: SubmitOutcome; submitRequests: string[] }> {
  const events: string[] = [`Confirmed submission requested for ${input.app.applyUrl}. Re-filling and re-verifying before submitting.`];
  const o = await open(input, events);
  const page = o.result.page!;
  const submitRequests: string[] = [];
  let clicked = false;
  const done = async (outcome: SubmitOutcome) => {
    const shot = await page.screenshot({ fullPage: true, type: "jpeg", quality: 55 }).catch(() => o.result.screenshotPng);
    await o.launched.browser.close().catch(() => undefined);
    return { ...evidence(o, events, shot), outcome, submitRequests };
  };
  try {
    // 1. The re-filled form must match what the user reviewed.
    const now = new Map(reviewedFields(o.result.report).map((f) => [fieldKey(f), f]));
    const differences: string[] = [];
    for (const f of reviewed.fields) {
      if (f.outcome !== "verified") continue;
      const n = now.get(fieldKey(f));
      if (n?.outcome !== "verified" || n.value !== f.value) differences.push(`${f.label}: reviewed "${f.value}", now ${n ? `"${n.value}" (${n.outcome})` : "missing"}`);
    }
    for (const n of now.values()) if (n.required && n.outcome !== "verified") differences.push(`Required field not completed: ${n.label} (${n.outcome})`);
    if (differences.length) return await done({ status: "not_submitted", reason: "The form did not re-fill exactly as reviewed, or a required field is incomplete. Nothing was submitted.", differences });

    // 2. Exactly one submit button.
    const buttons = await findSubmitButton(page);
    if (buttons.length !== 1) return await done({ status: "not_submitted", reason: `Expected one submit button, found ${buttons.length}. Nothing was submitted.` });

    // 3. Release the guard and click once.
    page.on("request", (r) => {
      if (r.method() !== "GET" && r.method() !== "HEAD" && r.method() !== "OPTIONS") submitRequests.push(`${r.method()} ${new URL(r.url()).host}${new URL(r.url()).pathname}`.slice(0, 160));
    });
    const responses: string[] = [];
    page.on("response", (r: Response) => {
      if (r.request().method() === "POST") responses.push(`${r.status()} ${new URL(r.url()).host}${new URL(r.url()).pathname}`.slice(0, 160));
    });
    await o.result.guard!.release(page);
    events.push(`Clicking "${buttons[0]!.text}" (user-approved).`);
    clicked = true;
    await buttons[0]!.c.click({ timeout: 10_000 });

    // 4. Look for a positive confirmation (or a blocker) for up to 45 s.
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(1_500);
      const url = page.url();
      const text = (await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "")).slice(0, 20_000);
      const m = CONFIRM_TEXT.exec(text);
      if (m || CONFIRM_URL.test(new URL(url).pathname)) {
        events.push(...responses.map((r) => `POST response: ${r}`));
        return await done({ status: "confirmed", confirmation: m ? text.slice(Math.max(0, m.index - 80), m.index + 200).replace(/\s+/g, " ").trim() : `Confirmation page: ${url}`, finalUrl: url });
      }
      if (await visibleChallenge(page)) {
        events.push(...responses.map((r) => `POST response: ${r}`));
        return await done({ status: "blocked", reason: "The site showed a CAPTCHA challenge after Submit. A human must complete it; the application was NOT confirmed.", finalUrl: url });
      }
    }
    events.push(...responses.map((r) => `POST response: ${r}`));
    const errText = (await page.locator('[role="alert"], .error, .error-message, .field-error, [aria-invalid="true"]').allInnerTexts().catch(() => [])).join(" | ").slice(0, 400);
    return await done({
      status: "uncertain",
      reason: `No confirmation from the employer within 45 s.${errText ? ` Page messages: ${errText}` : ""} Do not assume this application was submitted.`,
      finalUrl: page.url(),
    });
  } catch (e) {
    if (clicked) {
      // After the click we cannot know whether the employer received it.
      return await done({ status: "uncertain", reason: `Error after clicking submit (${e instanceof Error ? e.message.split("\n")[0] : String(e)}). Do not assume this application was submitted; check your email for a receipt.`, finalUrl: page.url() });
    }
    await o.launched.browser.close().catch(() => undefined);
    throw e;
  }
}
