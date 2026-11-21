/** Synthetic forms mimicking Greenhouse / Lever / Ashby structures. Local only; nothing submitted. */
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { autofillFixture, launch, startFixtureServer, writeResumeFile, type FixtureServer } from "../helpers/apply-harness";

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
const f = <F extends { label: string }>(fields: F[], re: RegExp) => {
  const x = fields.find((y) => re.test(y.label));
  if (!x) throw new Error(`no field ${re}: ${fields.map((y) => y.label).join(" | ")}`);
  return x;
};

describe("ATS-style forms", () => {
  it("Greenhouse-style: custom yes/no dropdowns, hidden file input behind Attach, EEO left alone", async () => {
    const { report, context } = await autofillFixture(browser, server, "greenhouse-like.html", { resumePath });
    try {
      expect(f(report.fields, /^First Name/)).toMatchObject({ outcome: "verified", value: "Avery" });
      expect(f(report.fields, /^Resume\/CV/)).toMatchObject({ kind: "resume", outcome: "verified" });
      expect(f(report.fields, /legally authorized/)).toMatchObject({ control: "combobox", outcome: "verified", value: "Yes" });
      expect(f(report.fields, /sponsorship/)).toMatchObject({ control: "combobox", outcome: "verified", value: "No" });
      expect(f(report.fields, /How did you hear/)).toMatchObject({ outcome: "verified", value: "LinkedIn" });
      expect(f(report.fields, /^Gender/)).toMatchObject({ tier: "guard", outcome: "needs_human" });
      expect(server.posts).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  it("Lever-style: single full-name field, URL fields, ambiguous 'Please select' card left for the person", async () => {
    const { report, context } = await autofillFixture(browser, server, "lever-like.html", { resumePath });
    try {
      expect(f(report.fields, /^Full name/)).toMatchObject({ kind: "full_name", outcome: "verified", value: "Avery Quinn" });
      expect(f(report.fields, /^Current company/)).toMatchObject({ outcome: "verified", value: "Northwind Labs" });
      expect(f(report.fields, /^GitHub URL/)).toMatchObject({ outcome: "verified" });
      expect(f(report.fields, /right to work/)).toMatchObject({ outcome: "verified", value: "Yes" });
      expect(report.fields.find((x) => x.control === "file")).toMatchObject({ outcome: "verified" });
      // The generic "Please select" card is labelled by its sub-question; no office preference stated -> never guessed.
      expect(f(report.fields, /^Which office would you prefer/)).toMatchObject({ outcome: "needs_human" });
      expect(report.fields.some((x) => x.label.includes("✱"))).toBe(false);
      expect(server.posts).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  it("Ashby-style: ARIA radio buttons (role=radio) and a display:none resume input", async () => {
    const { report, context, page } = await autofillFixture(browser, server, "ashby-like.html", { resumePath });
    try {
      expect(f(report.fields, /authorized to work/)).toMatchObject({ control: "radio", required: true, outcome: "verified", value: "Yes" });
      expect(f(report.fields, /visa sponsorship/)).toMatchObject({ outcome: "verified", value: "No" });
      expect(await page.getAttribute("#auth-q + [role=radiogroup] [role=radio]:first-child", "aria-checked")).toBe("true");
      expect(report.fields.find((x) => x.control === "file")).toMatchObject({ outcome: "verified" });
      expect(f(report.fields, /^Name$/)).toMatchObject({ outcome: "verified", value: "Avery Quinn" });
      expect(server.posts).toHaveLength(0);
    } finally {
      await context.close();
    }
  });
});
