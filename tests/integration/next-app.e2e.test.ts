/**
 * The real team Next.js app (next dev), the real unmodified Supabase
 * middleware, Postgres repositories over the local PGlite server, file
 * storage, and the browser worker as a separate component, driven through
 * the actual UI in Chromium.
 *
 * MOCKED: Supabase Auth is the local stand-in in scripts/dev/mock-auth.ts
 * (ES256 JWTs verified by @supabase/ssr via JWKS, exactly like real tokens),
 * and the LLM tier is the scripted mock. No external network.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { chromium, type Browser, type BrowserContext } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startFormHost, type FormHost } from "~/server/jobs/form-host";
import { createWorkerRuntime } from "~/server/jobs/runtime";
import { BrowserWorker } from "~/server/jobs/worker";
import { createLlmProviders } from "~/server/llm/factory";
import { startDevDb } from "../../scripts/dev/db";
import { startMockAuth, SYNTHETIC_USERS } from "../../scripts/dev/mock-auth";
import { stackEnv } from "../../scripts/dev/stack";
import { makePdf } from "../helpers/resume-fixtures";

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

let db: Awaited<ReturnType<typeof startDevDb>>;
let auth: Awaited<ReturnType<typeof startMockAuth>>;
let next: ChildProcess;
let browser: Browser;
let worker: BrowserWorker;
let formHost: FormHost;
let runtime: ReturnType<typeof createWorkerRuntime>;
let appUrl = "";
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "af-e2e-storage-"));

beforeAll(async () => {
  const [dbPort, appPort] = await Promise.all([freePort(), freePort()]);
  appUrl = `http://localhost:${appPort}`;
  db = await startDevDb({ dir: "memory://", port: dbPort });
  auth = await startMockAuth({ appUrl });
  const env = stackEnv({ databaseUrl: db.url, authUrl: auth.url, storageDir, llm: "mock" });
  // Own process group so next-server children are cleaned up too.
  next = spawn(path.resolve("node_modules/.bin/next"), ["dev", "-p", String(appPort)], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let out = "";
  const logFile = process.env.E2E_NEXT_LOG;
  const onData = (d: Buffer) => {
    out += d.toString();
    if (logFile) fs.appendFileSync(logFile, d);
  };
  next.stdout?.on("data", onData);
  next.stderr?.on("data", onData);
  for (let i = 0; i < 240 && !/Ready in|ready started/i.test(out); i++) await new Promise((r) => setTimeout(r, 250));
  if (!/Ready in|ready started/i.test(out)) throw new Error(`next dev did not start:\n${out.slice(-2000)}`);

  runtime = createWorkerRuntime(env);
  formHost = await startFormHost();
  browser = await chromium.launch({ headless: true });
  worker = new BrowserWorker({ ...runtime, formHost, launchBrowser: async () => browser, pollMs: 200, heartbeatMs: 500, extraProviders: () => createLlmProviders(env), logger: { info: () => undefined, warn: () => undefined, error: () => undefined } });
  worker.start();
}, 120_000);

afterAll(async () => {
  await worker?.stop();
  await formHost?.close();
  await runtime?.close();
  if (next?.pid) {
    try {
      process.kill(-next.pid, "SIGTERM");
      await new Promise((r) => setTimeout(r, 1000));
      process.kill(-next.pid, "SIGKILL");
    } catch {
      /* already exited */
    }
  }
  await browser?.close();
  await auth?.close();
  await db?.stop();
});

async function signedIn(userIndex: number): Promise<BrowserContext> {
  const ctx = await browser.newContext({ baseURL: appUrl });
  const c = await auth.sessionCookie(SYNTHETIC_USERS[userIndex]!);
  await ctx.addCookies([{ name: c.name, value: c.value, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  return ctx;
}

describe("team Next.js app: integrated apply workflow", () => {
  let applicationUrl = "";

  it("the team's middleware still protects pages (no bypass)", async () => {
    const ctx = await browser.newContext({ baseURL: appUrl });
    const page = await ctx.newPage();
    await page.goto("/apply", { timeout: 90_000 });
    expect(new URL(page.url()).pathname).toBe("/auth/login");
    // A token signed by any other key is rejected too.
    const forged = await startMockAuth();
    const c = await forged.sessionCookie(SYNTHETIC_USERS[0]!);
    await forged.close();
    await ctx.addCookies([{ name: `sb-localhost-auth-token`, value: c.value, domain: "localhost", path: "/" }]);
    await page.goto("/apply");
    expect(new URL(page.url()).pathname).toBe("/auth/login");
    await ctx.close();
  }, 120_000);

  it("upload -> review profile -> prepare -> worker fills -> review results", async () => {
    const ctx = await signedIn(0);
    const page = await ctx.newPage();
    await page.goto("/apply/profile", { timeout: 90_000 });
    await page.setInputFiles("#resume-file", { name: "synthetic-cv.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makePdf()) });
    await page.getByRole("button", { name: /upload and extract/i }).click();
    await expect.poll(() => page.inputValue("[name='contact.email']"), { timeout: 30_000 }).toBe("avery.quinn@example.com");

    await page.fill("[name='pref.workAuthCountry']", "Australia");
    await page.selectOption("[name='pref.workAuthorized']", "yes");
    await page.selectOption("[name='pref.needsSponsorship']", "no");
    await page.fill("[name='pref.salaryExpectation']", "150000");
    await page.fill("[name='contact.email']", "not-an-email");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect.poll(() => page.getByText("Enter a valid email address.").count(), { timeout: 60_000 }).toBe(1);
    await page.fill("[name='contact.email']", "avery.quinn@example.com");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect.poll(() => page.getByRole("status").filter({ hasText: "Saved." }).count(), { timeout: 60_000 }).toBe(1);

    await page.goto("/apply/new", { timeout: 60_000 });
    await page.getByText("Job requirements: Senior Software Engineer").waitFor();
    await page.fill("#job-url", "https://boards.greenhouse.io/example/jobs/123");
    await page.getByRole("button", { name: "Check link" }).click();
    await page.getByRole("status").filter({ hasText: /filling real job sites is not enabled yet/i }).waitFor();
    await page.getByLabel(/Use an LLM/).check();
    await page.getByRole("button", { name: /prepare and start autofill/i }).click();
    await page.waitForURL(/\/apply\/applications\//, { timeout: 60_000 });
    applicationUrl = new URL(page.url()).pathname;

    await page.getByText("Filled, awaiting your review").first().waitFor({ timeout: 90_000 });
    await page.getByText("Nothing was submitted.", { exact: false }).first().waitFor();
    const filledSection = page.locator("section", { has: page.getByRole("heading", { name: /Filled automatically/ }) });
    await expect.poll(() => filledSection.getByText("Rules").count()).toBeGreaterThan(5);
    await page.locator("section", { has: page.getByRole("heading", { name: /Blocked for safety/ }) }).getByText("Gender").waitFor();
    await page.getByText("AI draft: please edit").first().waitFor(); // mock LLM essay, flagged
    await page.getByText(/Ready for your review. Nothing was submitted./).waitFor(); // worker log
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>("img[alt^='Screenshot']");
      return !!img && img.complete && img.naturalWidth > 0;
    }, undefined, { timeout: 30_000 });
    const shot = await ctx.request.get(`${new URL(page.url()).pathname.replace("/apply/applications/", "/api/applications/")}/screenshot`);
    expect(shot.status()).toBe(200);
    expect(shot.headers()["content-type"]).toBe("image/png");

    // Submitted only after the user explicitly confirms.
    const record = page.getByRole("button", { name: "Record as submitted" });
    expect(await record.isDisabled()).toBe(true);
    await page.getByLabel(/submitted this application myself/).check();
    await record.click();
    await page.getByText("Submitted (confirmed by you)").first().waitFor();

    await page.goto("/apply");
    await page.getByText("Submitted (confirmed by you)").waitFor();
    await ctx.close();
  }, 240_000);

  it("full journey: job import -> match -> tailoring -> tailored resume -> prepared application -> autofill -> review -> handoff", async () => {
    const ctx = await signedIn(0); // profile was created in the previous test
    const page = await ctx.newPage();
    await page.goto("/apply/jobs", { timeout: 90_000 });
    await page.getByRole("tab", { name: "Paste description" }).click();
    const form = page.getByRole("form", { name: "Paste job description" });
    await form.getByLabel("Title").fill("Senior Frontend Engineer");
    await form.getByLabel("Company").fill("Example Corp");
    await form.getByLabel("Location").fill("Melbourne");
    await form.getByLabel("Job description").fill("About the role\nYou will build our web platform.\nRequirements:\n- 5+ years of experience with TypeScript\n- Experience with React and Node.js\n- Authorized to work in Australia\n- Experience with Kubernetes\nNice to have:\n- Playwright testing");
    await form.getByRole("button", { name: "Save job" }).click();
    await page.waitForURL(/\/apply\/jobs\/[0-9a-f-]{36}$/, { timeout: 60_000 });

    await page.getByRole("button", { name: "Check my match" }).click();
    await page.getByText(/requirements are stated in your profile/).waitFor({ timeout: 60_000 });
    expect(await page.getByText("Stated in your profile").count()).toBeGreaterThan(1);
    await page.getByText("Not in your profile").first().waitFor(); // Kubernetes: never invented

    await page.getByRole("button", { name: "Suggest tailoring" }).click();
    const decisions = page.getByRole("form", { name: "Tailoring decisions" });
    await decisions.waitFor({ timeout: 60_000 });
    for (const r of await decisions.getByLabel("Accept").all()) await r.check();
    await decisions.getByLabel("Answer: Why are you interested in Example Corp?").fill("I want to build Example Corp's web platform with TypeScript and React.");
    await decisions.getByLabel("Use this answer").first().check();
    await decisions.getByRole("button", { name: "Save decisions" }).click();
    await page.getByRole("button", { name: "Generate tailored resume (PDF)" }).click();
    const dl = page.getByRole("link", { name: "Download tailored resume" });
    await dl.waitFor({ timeout: 60_000 });
    const pdf = await ctx.request.get(await dl.getAttribute("href") ?? "");
    expect(pdf.headers()["content-type"]).toBe("application/pdf");

    await page.getByLabel("Test form to fill").selectOption("full-application");
    await page.getByRole("button", { name: "Prepare and start autofill" }).click();
    await page.waitForURL(/\/apply\/applications\//, { timeout: 60_000 });
    await page.getByText("Filled, awaiting your review").first().waitFor({ timeout: 90_000 });
    // The approved draft answer was used (filled by rules, flagged for review), and the tailored resume uploaded.
    await page.getByText("I want to build Example Corp's web platform with TypeScript and React.").first().waitFor();
    await page.getByRole("cell", { name: /Resume\/CV/ }).first().waitFor();

    const id = new URL(page.url()).pathname.split("/").pop()!;
    const plan = await ctx.request.get(`/api/applications/${id}/fill-plan`);
    expect(plan.status()).toBe(200);
    const body = (await plan.json()) as { plan: { fields: { label: string }[]; resume: { filename: string } | null } };
    expect(body.plan.resume?.filename).toMatch(/tailored\.pdf$/);
    expect(body.plan.fields.some((f) => /Gender/.test(f.label))).toBe(false);
    await page.getByRole("button", { name: "Send to browser extension" }).click();
    await page.getByText(/extension was not detected|Sent \d+ answers/).waitFor({ timeout: 10_000 }); // no extension in this test browser

    await page.goto("/apply/jobs");
    await page.getByText("Senior Frontend Engineer").waitFor();
    await ctx.close();
  }, 300_000);

  it("another user cannot see or act on the application", async () => {
    const ctx = await signedIn(1);
    const page = await ctx.newPage();
    const res = await page.goto(applicationUrl, { timeout: 60_000 });
    expect(res?.status()).toBe(404);
    const id = applicationUrl.split("/").pop()!;
    const api = await ctx.request.get(`/api/applications/${id}`);
    expect(api.status()).toBe(404);
    const shot = await ctx.request.get(`/api/applications/${id}/screenshot`);
    expect(shot.status()).toBe(404);
    await ctx.close();
  }, 120_000);

  it("rejects cross-origin mutations and malformed bodies", async () => {
    const ctx = await signedIn(0);
    const evil = await ctx.request.post("/api/applications", { headers: { origin: "https://evil.example", "content-type": "application/json" }, data: { targetKey: "basic" } });
    expect(evil.status()).toBe(403);
    const wrongType = await ctx.request.post("/api/applications", { headers: { "content-type": "text/plain" }, data: "{}" });
    expect(wrongType.status()).toBe(415);
    const unknown = await ctx.request.post("/api/applications", { data: { targetKey: "https://real-site.example" } });
    expect(unknown.status()).toBe(400);
    await ctx.close();
  }, 120_000);

  it("shows a clear session-expired message when the session ends mid-task", async () => {
    const ctx = await signedIn(0);
    const page = await ctx.newPage();
    await page.goto("/apply/profile", { timeout: 60_000 });
    await page.getByRole("button", { name: "Save profile" }).waitFor({ timeout: 60_000 });
    await ctx.clearCookies(); // session expires while the page is open
    await page.getByRole("button", { name: "Save profile" }).click();
    await page.getByRole("status").filter({ hasText: "Your session expired. Please sign in again." }).waitFor({ timeout: 30_000 });
    await ctx.close();
  }, 120_000);

  it("documents the middleware behaviour for anonymous API calls", async () => {
    // Known team-middleware behaviour: anonymous /api requests are redirected to
    // the login page rather than receiving our JSON 401. The UI treats a
    // non-JSON/401 response as "session expired". See docs/SUPABASE_INTEGRATION.md.
    const ctx = await browser.newContext({ baseURL: appUrl });
    const res = await ctx.request.get("/api/profile", { maxRedirects: 0 });
    expect([307, 308, 401]).toContain(res.status());
    await ctx.close();
  }, 60_000);
});
