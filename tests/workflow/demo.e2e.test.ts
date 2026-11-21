/**
 * Connected workflow through the demo's real HTTP API and a real browser:
 * upload -> extract -> parse -> review edits -> Decision Engine -> Playwright
 * autofill -> report. MOCKED: storage (memory) and the LLM tier (scripted).
 * No Supabase, no real job sites, no real model.
 */
import http from "node:http";

import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RuleProvider } from "~/lib/apply/decision/rules";
import { runApplication } from "~/server/workflow/run-application";
import { createDemoServer } from "../../demo/server";
import { startFixtureServer, syntheticProfile } from "../helpers/apply-harness";
import { makeDocx, makePdf } from "../helpers/resume-fixtures";

type Field = { label: string; kind: string; tier: string; outcome: string; value?: unknown; reason?: string; reviewRequired?: boolean; round: number };
type RunBody = { report: { fields: Field[]; metrics: { errors: number; mismatches: number; llmCalls: number; rounds: number }; blockedSubmits: { inPage: number; network: number }; stoppedBeforeSubmit: boolean }; submissionsReceived: number; blockedEgress: string[]; screenshot: string };

let browser: Browser;
let demo: ReturnType<typeof createDemoServer>;
let origin: string;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  demo = createDemoServer({ browser });
  origin = await demo.listen(0);
});
afterAll(async () => {
  await demo?.close();
  await browser?.close();
});

const call = (path: string, init: RequestInit = {}) => fetch(`${origin}${path}`, { ...init, headers: { origin, ...(init.headers ?? {}) } });

async function upload(bytes: Uint8Array, name: string) {
  const fd = new FormData();
  fd.append("resume", new File([new Uint8Array(bytes)], name));
  return call("/api/upload", { method: "POST", body: fd });
}

async function run(form: string, llm: "none" | "mock" = "none") {
  const res = await call("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ form, llm }) });
  expect(res.status).toBe(200);
  return (await res.json()) as RunBody;
}

const field = (b: RunBody, re: RegExp) => {
  const f = b.report.fields.find((x) => re.test(x.label));
  if (!f) throw new Error(`no field matching ${re}: ${b.report.fields.map((x) => x.label).join(" | ")}`);
  return f;
};

describe("demo workflow (HTTP API)", () => {
  it("refuses to run before a resume is uploaded", async () => {
    const res = await call("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ form: "basic.html" }) });
    expect(res.status).toBe(409);
  });

  it("rejects invalid uploads", async () => {
    expect((await upload(new TextEncoder().encode("not a resume"), "x.pdf")).status).toBe(400);
    expect((await upload(await makePdf([""]), "blank.pdf")).status).toBe(422);
  });

  it("upload -> parsed profile -> review -> autofill full application (rules only)", async () => {
    const up = await upload(await makePdf(), "avery.pdf");
    expect(up.status).toBe(201);
    const upBody = (await up.json()) as { resume: { path: string }; missing: string[]; review: { contact: Record<string, { value: string }> } };
    expect(upBody.resume.path).toMatch(/^demo-user\/resumes\/.+\.pdf$/);
    expect(upBody.review.contact.email!.value).toBe("avery.quinn@example.com");

    // Before preferences are set, sensitive-but-answerable questions go to the person.
    const before = await run("full-application.html");
    expect(field(before, /authorized to work/)).toMatchObject({ outcome: "needs_human" });

    // Review step: correct a value and add preferences.
    const put = await call("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contact: { phone: "+61 400 555 999" }, preferences: { workAuthCountry: "Australia", workAuthorized: "yes", needsSponsorship: "no", salaryExpectation: "150000", noticePeriod: "4 weeks", referralSource: "LinkedIn" } }),
    });
    expect(put.status).toBe(200);

    const b = await run("full-application.html");
    expect(b.report.stoppedBeforeSubmit).toBe(true);
    expect(b.submissionsReceived).toBe(0);
    expect(field(b, /^First name/)).toMatchObject({ tier: "rule", outcome: "verified", value: "Avery" });
    expect(field(b, /^Phone/)).toMatchObject({ outcome: "verified", value: "+61 400 555 999" }); // reviewed value used
    expect(field(b, /^Resume/)).toMatchObject({ kind: "resume", outcome: "verified" });
    expect(field(b, /Location \(City\)/)).toMatchObject({ outcome: "verified", value: "Melbourne" });
    const labels = b.report.fields.filter((f) => f.round === 1).map((f) => f.label);
    expect(labels.findIndex((l) => /authorized to work/.test(l))).toBeLessThan(labels.findIndex((l) => /salary expectations/.test(l))); // on-page order
    expect(field(b, /authorized to work/)).toMatchObject({ tier: "rule", outcome: "verified", value: "Yes" });
    expect(field(b, /sponsorship/)).toMatchObject({ outcome: "verified", value: "No" });
    expect(field(b, /salary expectations/)).toMatchObject({ outcome: "verified", value: "150000" });
    expect(field(b, /notice period/)).toMatchObject({ outcome: "verified", value: "4 weeks" });
    expect(field(b, /How did you hear/)).toMatchObject({ outcome: "verified", value: "LinkedIn" });
    expect(field(b, /How many years/)).toMatchObject({ outcome: "verified", value: "5-7" });
    expect(field(b, /Cover letter/)).toMatchObject({ outcome: "skipped" });
    for (const re of [/^Gender/, /Veteran/, /privacy policy/]) expect(field(b, re)).toMatchObject({ tier: "guard", outcome: "needs_human" });
    expect(field(b, /Why do you want/)).toMatchObject({ outcome: "needs_human" }); // no LLM tier
    expect(field(b, /TypeScript/)).toMatchObject({ outcome: "needs_human" });
    expect(b.report.metrics.errors + b.report.metrics.mismatches).toBe(0);
    expect(b.report.metrics.llmCalls).toBe(0);
    expect(b.screenshot).toMatch(/^data:image\/png;base64,/);
  });

  it("with the mock LLM tier: one call, essay drafted and flagged for review", async () => {
    const b = await run("full-application.html", "mock");
    expect(b.report.metrics.llmCalls).toBe(1);
    expect(field(b, /Why do you want/)).toMatchObject({ tier: "llm", outcome: "verified", reviewRequired: true });
    expect(field(b, /^Gender/)).toMatchObject({ tier: "guard", outcome: "needs_human" });
  });

  it("blocks every submit attempt on the trap form", async () => {
    const b = await run("trap.html");
    expect(b.report.blockedSubmits.inPage + b.report.blockedSubmits.network).toBeGreaterThanOrEqual(3);
    expect(b.submissionsReceived).toBe(0);
  });

  it("handles the dynamic form and a DOCX resume", async () => {
    expect((await upload(await makeDocx(), "avery.docx")).status).toBe(201);
    const b = await run("dynamic.html");
    expect(b.report.fields.find((f) => f.kind === "phone")).toMatchObject({ outcome: "verified" });
    expect(b.report.metrics.rounds).toBeGreaterThanOrEqual(2);
  });
});

describe("demo isolation", () => {
  it("rejects state-changing requests without a same-origin Origin header", async () => {
    const res = await fetch(`${origin}/api/reset`, { method: "POST", headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });

  it("rejects foreign Host headers (DNS rebinding)", async () => {
    const port = new URL(origin).port;
    const status = await new Promise<number>((resolve, reject) => {
      http.get({ host: "127.0.0.1", port, path: "/api/state", headers: { host: `attacker.example:${port}` } }, (r) => resolve(r.statusCode ?? 0)).on("error", reject);
    });
    expect(status).toBe(421);
  });

  it("only serves allow-listed forms and refuses unknown ones for runs", async () => {
    expect((await call("/forms/../package.json")).status).toBe(404);
    expect((await call("/forms/not-a-form.html")).status).toBe(404);
    const res = await call("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ form: "https://example.com/apply" }) });
    expect(res.status).toBe(400);
  });

  it("runApplication refuses a form outside the egress allowlist", async () => {
    await expect(runApplication({ formUrl: "https://example.com/apply", profile: syntheticProfile(), resume: null, providers: [new RuleProvider()], allowedOrigins: [origin], browser })).rejects.toThrow(/not allowed/);
  });

  it("aborts page requests to any other origin before they leave the machine", async () => {
    const fx = await startFixtureServer();
    try {
      const r = await runApplication({ formUrl: `${fx.url}/egress.html`, profile: syntheticProfile(), resume: null, providers: [new RuleProvider()], allowedOrigins: [fx.url], browser });
      expect(r.blockedEgress).toEqual(expect.arrayContaining(["https://example.com/tracking-pixel.png", "https://example.com/beacon"]));
      expect(r.report.fields.find((f) => f.kind === "email")).toMatchObject({ outcome: "verified" });
    } finally {
      await fx.close();
    }
  });

  it("binds to loopback only", () => {
    expect(new URL(origin).hostname).toBe("127.0.0.1");
  });
});

describe("demo UI (real browser clicking through the page)", () => {
  it("upload -> review -> choose form -> application review", async () => {
    await call("/api/reset", { method: "POST" });
    const page = await browser.newPage();
    try {
      await page.goto(origin);
      await page.setInputFiles("#resume-file", { name: "avery.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makePdf()) });
      await page.click("#upload-btn");
      await page.waitForSelector("#step-2:not([hidden])");
      expect(await page.inputValue('input[name="contact.email"]')).toBe("avery.quinn@example.com");

      // Edit in the review UI.
      await page.fill('input[name="workAuthCountry"]', "Australia");
      await page.selectOption('select[name="workAuthorized"]', "yes");
      await page.selectOption('select[name="needsSponsorship"]', "no");
      await page.fill('input[name="contact.firstName"]', "Avery-Jo");
      await page.click("#save-profile");
      await page.waitForSelector("#step-3:not([hidden])");

      await page.check('input[name="form"][value="full-application.html"]');
      await page.check('input[name="llm"][value="mock"]');
      await page.click("#run-btn");
      await page.waitForSelector("#step-4:not([hidden])", { timeout: 30_000 });

      expect(await page.textContent("#nothing-submitted")).toContain("Nothing was submitted");
      const rows = await page.$$eval("#fields-table tbody tr", (trs) => trs.map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent ?? "")));
      const first = rows.find((r) => r[0]!.startsWith("First name"))!;
      expect(first[2]).toBe("Rules");
      expect(first[3]).toBe("Filled ✓");
      expect(first[4]).toBe("Avery-Jo");
      expect(rows.find((r) => r[0]!.startsWith("Gender"))?.[2]).toBe("Safety guard");
      expect(rows.find((r) => r[0]!.startsWith("Why do you want"))?.[2]).toBe("LLM (mock)");

      await page.check('input[name="filter"][value="human"]');
      const humanRows = await page.$$eval("#fields-table tbody tr td:nth-child(4)", (tds) => tds.map((t) => t.textContent));
      expect(humanRows.length).toBeGreaterThan(0);
      expect(humanRows.every((t) => t === "Needs you" || t === "Skipped")).toBe(true);
    } finally {
      await page.close();
    }
  });
});
