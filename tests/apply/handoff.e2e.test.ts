/**
 * Browser-extension handoff proof of concept: a plan built from a real worker
 * run is applied to a FRESH copy of the form (as in the user's own browser),
 * and the actual MV3 extension is loaded to check its app-page bridge.
 * Local synthetic forms only; nothing is submitted.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildFillPlan } from "~/lib/applications/fill-plan";
import { autofillFixture, launch, startFixtureServer, syntheticProfile, writeResumeFile, type FixtureServer } from "../helpers/apply-harness";

const EXT = path.resolve(import.meta.dirname, "../../extension");
let browser: Browser;
let server: FixtureServer;
let resumePath: string;
beforeAll(async () => {
  [browser, server, resumePath] = await Promise.all([launch(), startFixtureServer(), writeResumeFile()]);
});
afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function planFromWorkerRun() {
  const profile = syntheticProfile();
  profile.preferences.savedAnswers = { "@why_company": "I admire Example Corp's engineering culture." };
  const { report, context } = await autofillFixture(browser, server, "full-application.html", { resumePath, profile });
  await context.close();
  return buildFillPlan({ id: "app-1", title: "Senior Software Engineer", company: "Example Corp", report }, { filename: "avery-tailored.pdf", bytes: new Uint8Array(fs.readFileSync(resumePath)) });
}

describe("handoff fill plan + filler", () => {
  it("fills a fresh copy of the form in the user's browser, highlights what needs them, never submits", async () => {
    const plan = await planFromWorkerRun();
    expect(plan.fields.some((f) => /gender|veteran|privacy/i.test(f.label))).toBe(false); // never carries guarded fields
    expect(plan.needsInput.map((n) => n.label)).toEqual(expect.arrayContaining(["Gender", "Veteran status"]));

    const ctx = await browser.newContext(); // plain browser: no submit guard installed
    const page = await ctx.newPage();
    await page.goto(`${server.url}/full-application.html`);
    await page.addScriptTag({ path: path.join(EXT, "filler.js") });
    const result = await page.evaluate((p) => (window as unknown as { __auraApplyPlan: (x: unknown) => { filled: string[]; notFound: string[]; needsInput: string[] } }).__auraApplyPlan(p), plan);
    expect(result.notFound).toEqual([]);
    expect(await page.inputValue("#first")).toBe("Avery");
    expect(await page.inputValue("#email")).toBe("avery.quinn@example.com");
    expect(await page.isChecked("input[name=auth][value=yes]")).toBe(true);
    expect(await page.isChecked("input[name=sponsor][value=no]")).toBe(true);
    expect(await page.inputValue("#yrs")).toBe("5-7");
    expect(await page.inputValue("#why")).toBe("I admire Example Corp's engineering culture.");
    expect(await page.getAttribute("#why", "data-aura-handoff")).toBe("review"); // drafted text flagged
    expect(await page.evaluate(() => (document.getElementById("resume") as HTMLInputElement).files?.[0]?.name)).toBe("avery-tailored.pdf");
    expect(await page.inputValue("#gender")).toBe(""); // left for the person
    expect(await page.locator("[data-aura-handoff=needs]").count()).toBeGreaterThan(0);
    expect(await page.textContent("[data-aura-panel]")).toContain("submit the form yourself");
    await page.waitForTimeout(300);
    expect(server.posts).toHaveLength(0);
    await ctx.close();
  });

  it("refuses an expired plan", async () => {
    const plan = { ...(await planFromWorkerRun()), expiresAt: new Date(Date.now() - 1000).toISOString() };
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${server.url}/full-application.html`);
    await page.addScriptTag({ path: path.join(EXT, "filler.js") });
    await expect(page.evaluate((p) => (window as unknown as { __auraApplyPlan: (x: unknown) => unknown }).__auraApplyPlan(p), plan)).rejects.toThrow(/expired/);
    await ctx.close();
  });
});

describe("MV3 extension (real Chromium, unpacked)", () => {
  it("loads, and its bridge accepts a plan only from the app page itself", async () => {
    const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "af-ext-"));
    let ctx;
    try {
      ctx = await chromium.launchPersistentContext(userDir, { channel: "chromium", headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
    } catch (e) {
      console.warn("Skipping: this Chromium build cannot load extensions headless:", (e as Error).message.split("\n")[0]);
      return;
    }
    try {
      const page = await ctx.newPage();
      const plan = { version: 1, applicationId: "app-xyz", fields: [], needsInput: [], expiresAt: new Date(Date.now() + 60_000).toISOString() };
      await page.goto(`${server.url}/handoff-app.html#${encodeURIComponent(JSON.stringify(plan))}`);
      await page.waitForFunction(() => document.getElementById("ack")?.textContent !== "waiting", undefined, { timeout: 10_000 });
      expect(await page.textContent("#ack")).toBe("received:app-xyz");
    } finally {
      await ctx.close();
    }
  });
});

describe("filler on ATS-style forms (fresh page, plain browser)", () => {
  type Result = { filled: string[]; notFound: string[]; needsInput: string[]; unconfirmed: string[] };
  async function handoff(form: string) {
    const { report, context } = await autofillFixture(browser, server, form, { resumePath });
    await context.close();
    const plan = buildFillPlan({ id: "app-ats", title: "Engineer", company: "Example Corp", report }, { filename: "cv.pdf", bytes: new Uint8Array(fs.readFileSync(resumePath)) });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${server.url}/${form}`);
    await page.addScriptTag({ path: path.join(EXT, "filler.js") });
    const result = await page.evaluate((p) => (window as unknown as { __auraApplyPlan: (x: unknown) => Promise<Result> }).__auraApplyPlan(p), plan);
    return { plan, page, ctx, result };
  }

  it("Greenhouse-style: fills searchable yes/no dropdowns and confirms them in the browser", async () => {
    const { plan, page, ctx, result } = await handoff("greenhouse-like.html");
    try {
      expect(plan.fields.filter((f) => f.control === "combobox").map((f) => f.value).sort()).toEqual(["No", "Yes"]);
      expect(result.notFound).toEqual([]);
      expect(result.unconfirmed).toEqual([]);
      expect(await page.inputValue("input[name=q1]")).toBe("Yes");
      expect(await page.inputValue("input[name=q2]")).toBe("No");
      expect(await page.inputValue("#gender")).toBe("");
      expect(server.posts).toHaveLength(0);
    } finally {
      await ctx.close();
    }
  });

  it("Ashby-style: clicks ARIA radio buttons and attaches the resume to a display:none input", async () => {
    const { page, ctx, result } = await handoff("ashby-like.html");
    try {
      expect(result.notFound).toEqual([]);
      expect(result.unconfirmed).toEqual([]);
      expect(await page.getAttribute("#auth-q + [role=radiogroup] [role=radio]:first-child", "aria-checked")).toBe("true");
      expect(await page.evaluate(() => (document.getElementById("_systemfield_resume") as HTMLInputElement).files?.length)).toBe(1);
      expect(server.posts).toHaveLength(0);
    } finally {
      await ctx.close();
    }
  });

  it("reports fields it cannot find instead of guessing (page changed since the plan)", async () => {
    const { report, context } = await autofillFixture(browser, server, "basic.html", { resumePath });
    await context.close();
    const plan = buildFillPlan({ id: "app-x", title: null, company: null, report }, null);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${server.url}/lever-like.html`); // a different form
    await page.addScriptTag({ path: path.join(EXT, "filler.js") });
    const result = await page.evaluate((p) => (window as unknown as { __auraApplyPlan: (x: unknown) => Promise<{ notFound: string[]; filled: string[] }> }).__auraApplyPlan(p), plan);
    expect(result.notFound.length).toBeGreaterThan(3);
    expect(await page.textContent("[data-aura-panel]")).toContain("had no matching field");
    await ctx.close();
  });
});
