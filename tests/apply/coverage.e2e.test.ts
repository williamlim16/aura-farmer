/**
 * Form-coverage tests: custom comboboxes, multi-step navigation with the
 * form's own validation, conditional fields, same-origin iframes and upload
 * restrictions. Local synthetic forms only; LLM not used.
 */
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RuleProvider } from "~/lib/apply/decision/rules";
import { runApplication } from "~/server/workflow/run-application";
import { autofillFixture, launch, startFixtureServer, syntheticProfile, writeResumeFile, type FixtureServer } from "../helpers/apply-harness";

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

const label = <F extends { label: string }>(fields: F[], re: RegExp) => {
  const f = fields.find((x) => re.test(x.label));
  if (!f) throw new Error(`no field ${re}: ${fields.map((x) => x.label).join(" | ")}`);
  return f;
};

describe("multi-step form", () => {
  it("stops on step 1 and reports the form's own validation error", async () => {
    const { report, context } = await autofillFixture(browser, server, "multi-step.html", { resumePath }); // phone has spaces
    try {
      expect(report.steps).toEqual([{ step: 1, advanced: false, stoppedBecause: "The form reported: Use digits only, e.g. 61400555123." }]);
      expect(label(report.fields, /^Mobile/)).toMatchObject({ outcome: "error", reason: expect.stringContaining("Use digits only") });
      expect(label(report.fields, /^Country of residence/)).toMatchObject({ control: "combobox", kind: "country", tier: "rule", outcome: "verified", value: "Australia" });
      expect(server.posts).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  it("advances through steps with a valid profile, fills custom dropdowns, stops before submit", async () => {
    const profile = syntheticProfile();
    profile.contact.phone = { value: "+61400555123", source: "user", confidence: 1 };
    const { report, context, page } = await autofillFixture(browser, server, "multi-step.html", { resumePath, profile });
    try {
      expect(report.steps).toEqual([{ step: 1, advanced: true }, { step: 2, advanced: true }]);
      expect(label(report.fields, /How did you hear/)).toMatchObject({ control: "combobox", step: 2, outcome: "verified", value: "LinkedIn" });
      expect(label(report.fields, /authorised to work/)).toMatchObject({ step: 2, outcome: "verified", value: "Yes" });
      expect(label(report.fields, /^Resume/)).toMatchObject({ step: 2, outcome: "verified" });
      // Conditional textarea only appears if on-call = yes; profile doesn't say, so it never appears.
      expect(report.fields.some((f) => /Describe your on-call/.test(f.label))).toBe(false);
      expect(label(report.fields, /Why Example Labs/)).toMatchObject({ step: 3, outcome: "needs_human" });
      expect(label(report.fields, /terms and conditions/)).toMatchObject({ tier: "guard", outcome: "needs_human" });
      expect(await page.locator("#step-label").textContent()).toBe("Step 3 of 3");
      expect(report.blockedSubmits.inPage + report.blockedSubmits.network).toBe(0);
      expect(server.posts).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  it("does not advance while a required field still needs the person", async () => {
    const profile = syntheticProfile();
    profile.contact.phone = { value: "+61400555123", source: "user", confidence: 1 };
    delete profile.preferences.workAuthorization;
    const { report, context } = await autofillFixture(browser, server, "multi-step.html", { resumePath, profile });
    try {
      expect(report.steps).toEqual([{ step: 1, advanced: true }, { step: 2, advanced: false, stoppedBecause: expect.stringContaining("need your input") }]);
    } finally {
      await context.close();
    }
  });
});

describe("iframe-embedded form", () => {
  it("fills a same-origin iframe and blocks the third-party frame", async () => {
    const r = await runApplication({ formUrl: `${server.url}/iframe.html`, profile: syntheticProfile(), resume: null, providers: [new RuleProvider()], allowedOrigins: [server.url], browser });
    expect(r.report.formLocation).toBe("/basic.html");
    expect(label(r.report.fields, /^First name/)).toMatchObject({ outcome: "verified", value: "Avery" });
    expect(r.blockedEgress.some((u) => u.startsWith("https://example.com/"))).toBe(true);
    expect(server.posts).toHaveLength(0);
  });
});

describe("file upload restrictions", () => {
  it("reports a clear error when the upload does not accept the resume type", async () => {
    const { report, context } = await autofillFixture(browser, server, "upload-accept.html", { resumePath });
    try {
      expect(report.fields.find((f) => f.control === "file")).toMatchObject({ outcome: "error", reason: expect.stringContaining("only accepts .docx") });
    } finally {
      await context.close();
    }
  });
});

describe("hostile page (security review)", () => {
  it("cannot redirect the Next click with a pre-planted marker attribute", async () => {
    const { report, context, page } = await autofillFixture(browser, server, "spoof-next.html", { resumePath });
    try {
      expect(new URL(page.url()).pathname).toBe("/spoof-next.html"); // decoy link not followed
      expect(report.steps[0]).toMatchObject({ step: 1, advanced: true });
      expect(report.fields.find((f) => f.kind === "email")).toMatchObject({ step: 2, outcome: "verified" });
    } finally {
      await context.close();
    }
  });
});
