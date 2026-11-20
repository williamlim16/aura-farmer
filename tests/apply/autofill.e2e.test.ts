/**
 * End-to-end autofill against local synthetic forms in headless Chromium.
 * MOCKED: no real job sites, no real LLM. The LLM tier uses ScriptedLlm.
 */
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LlmProvider, ScriptedLlm } from "~/lib/apply/decision/llm";
import { RuleProvider } from "~/lib/apply/decision/rules";
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

const byLabel = <F extends { label: string }>(report: { fields: F[] }, re: RegExp) => report.fields.find((f) => re.test(f.label))!;

describe("basic form (rules only)", () => {
  it("fills and verifies every field with zero model calls", async () => {
    const { report, context } = await autofillFixture(browser, server, "basic.html", { resumePath });
    try {
      const vals = Object.fromEntries(report.fields.map((f) => [f.kind, f]));
      expect(vals.first_name).toMatchObject({ outcome: "verified", value: "Avery" });
      expect(vals.last_name).toMatchObject({ outcome: "verified", value: "Quinn" });
      expect(vals.email).toMatchObject({ outcome: "verified", value: "avery.quinn@example.com" });
      expect(vals.phone?.outcome).toBe("verified");
      expect(vals.linkedin?.outcome).toBe("verified");
      expect(vals.github?.outcome).toBe("verified");
      expect(vals.resume?.outcome).toBe("verified");
      expect(vals.years_experience).toMatchObject({ outcome: "verified", value: "6-9" });
      expect(report.metrics.requiredCompletion).toBe(1);
      expect(report.metrics.errors).toBe(0);
      expect(report.metrics.llmCalls).toBe(0);
      expect(report.stoppedBeforeSubmit).toBe(true);
      expect(server.posts).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  it("hands the resume field to the person when no resume exists", async () => {
    const { report, context } = await autofillFixture(browser, server, "basic.html", { resumePath: null });
    expect(report.fields.find((f) => f.kind === "resume")).toMatchObject({ outcome: "needs_human" });
    await context.close();
  });
});

describe("ambiguous form", () => {
  it("resolves weak labels, refuses sensitive fields, skips honeypots", async () => {
    const { report, page, context } = await autofillFixture(browser, server, "ambiguous.html", { resumePath });
    try {
      expect(byLabel(report, /^Name$/)).toMatchObject({ kind: "full_name", outcome: "verified", value: "Avery Quinn" });
      expect(byLabel(report, /^Email address$/)).toMatchObject({ outcome: "verified" });
      expect(byLabel(report, /^Mobile number$/)).toMatchObject({ kind: "phone", outcome: "verified" });
      expect(byLabel(report, /LinkedIn/)).toMatchObject({ kind: "linkedin", outcome: "verified" });
      expect(byLabel(report, /authorized to work/)).toMatchObject({ kind: "work_authorization", outcome: "verified", value: "Yes" });
      expect(byLabel(report, /sponsorship/)).toMatchObject({ kind: "sponsorship", outcome: "verified", value: "No" });
      expect(byLabel(report, /Expected salary/)).toMatchObject({ kind: "salary", outcome: "verified", value: "150000" });
      // Safety: never filled, regardless of what the profile holds.
      for (const re of [/Current salary/, /Gender/, /AI assistant/, /privacy policy/]) {
        expect(byLabel(report, re)).toMatchObject({ outcome: "needs_human", tier: "guard" });
      }
      expect(await page.locator("[name=q14]").isChecked()).toBe(false);
      // Skill-specific years are not the total: no rule answer, no LLM configured -> human.
      expect(byLabel(report, /Kubernetes/)).toMatchObject({ outcome: "needs_human" });
      // "Country of residence" has no profile field: left for the person, not guessed.
      expect(byLabel(report, /Country of residence/).outcome).toBe("needs_human");
      expect(report.fields.some((f) => /honeypot/.test(f.label))).toBe(false);
      expect(report.metrics.llmCalls).toBe(0);
      expect(server.posts).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  it("with an LLM tier: one batched call, sensitive fields never sent, essays flagged for review", async () => {
    const llm = new ScriptedLlm((fields) =>
      fields.map((f) =>
        /why do you want/i.test(f.label)
          ? { id: f.id, value: "I build reliable TypeScript platforms and admire Example Corp's engineering culture.", confidence: 0.8 }
          : /country/i.test(f.label)
            ? { id: f.id, value: "Australia", confidence: 0.9 }
            : { id: f.id, value: "", confidence: 0 },
      ),
    );
    const { report, context } = await autofillFixture(browser, server, "ambiguous.html", { resumePath, providers: [new RuleProvider(), new LlmProvider(llm)] });
    try {
      expect(llm.requests).toHaveLength(1);
      const sent = llm.requests[0]!.user;
      for (const banned of ["Gender", "Current salary", "haiku", "privacy policy"]) expect(sent).not.toContain(banned);
      expect(byLabel(report, /Country of residence/)).toMatchObject({ tier: "llm", outcome: "verified", value: "Australia" });
      expect(byLabel(report, /Why do you want/)).toMatchObject({ tier: "llm", outcome: "verified", reviewRequired: true });
      expect(byLabel(report, /Kubernetes/)).toMatchObject({ tier: "llm", outcome: "needs_human" });
      expect(report.metrics.llmCalls).toBe(1);
      expect(server.posts).toHaveLength(0);
    } finally {
      await context.close();
    }
  });
});

describe("dynamic form", () => {
  it("picks up delayed fields in a later round", async () => {
    const { report, context } = await autofillFixture(browser, server, "dynamic.html", { resumePath });
    try {
      const phone = report.fields.find((f) => f.kind === "phone");
      expect(phone).toMatchObject({ outcome: "verified" });
      expect(report.fields.find((f) => f.kind === "referral_source")).toMatchObject({ outcome: "verified", value: "LinkedIn" });
      // Referral was not chosen, so the conditional referrer field never appeared.
      expect(report.fields.some((f) => /Referrer/.test(f.label))).toBe(false);
      expect(report.metrics.rounds).toBeGreaterThanOrEqual(2);
    } finally {
      await context.close();
    }
  });

  it("reveals a conditional field and leaves it for the person", async () => {
    const { syntheticProfile } = await import("../helpers/apply-harness");
    const profile = syntheticProfile();
    profile.preferences.referralSource = "Referral";
    const { report, context } = await autofillFixture(browser, server, "dynamic.html", { resumePath, profile });
    try {
      const ref = report.fields.find((f) => /Referrer/.test(f.label));
      expect(ref).toBeDefined();
      expect(ref!.round).toBeGreaterThan(1);
      expect(ref!.outcome).toBe("needs_human");
    } finally {
      await context.close();
    }
  });
});

describe("stop-before-submit", () => {
  it("blocks form.submit(), requestSubmit() and POST fetch from a hostile page", async () => {
    const { report, context } = await autofillFixture(browser, server, "trap.html", { resumePath });
    try {
      expect(report.fields.filter((f) => f.outcome === "verified")).toHaveLength(2);
      expect(report.blockedSubmits.inPage).toBeGreaterThanOrEqual(2);
      expect(report.blockedSubmits.network).toBeGreaterThanOrEqual(1);
      expect(server.posts).toHaveLength(0);
    } finally {
      await context.close();
    }
  });
});

describe("failure recovery", () => {
  it("survives an LLM outage: fields go to the person, rule fills still land", async () => {
    const llm = new ScriptedLlm(() => [], { fail: true });
    const { report, context } = await autofillFixture(browser, server, "ambiguous.html", { resumePath, providers: [new RuleProvider(), new LlmProvider(llm)] });
    try {
      expect(byLabel(report, /^Name$/).outcome).toBe("verified");
      expect(byLabel(report, /Why do you want/)).toMatchObject({ outcome: "needs_human", reason: expect.stringContaining("LLM unavailable") });
      expect(report.metrics.errors).toBe(0);
    } finally {
      await context.close();
    }
  });

  it("rejects an LLM answer that is not one of the options", async () => {
    const llm = new ScriptedLlm((fields) => fields.map((f) => ({ id: f.id, value: /country/i.test(f.label) ? "Australiaa" : "", confidence: 0.95 })));
    const { report, context } = await autofillFixture(browser, server, "ambiguous.html", { resumePath, providers: [new RuleProvider(), new LlmProvider(llm)] });
    expect(byLabel(report, /Country of residence/)).toMatchObject({ outcome: "needs_human", reason: expect.stringContaining("not one of the options") });
    await context.close();
  });
});
