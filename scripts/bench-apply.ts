/**
 * Reproducible autofill benchmark over the synthetic test forms.
 *
 *   pnpm bench:apply            # writes bench-results/apply-<timestamp>.{json,md}
 *
 * Configurations (same forms, same synthetic applicant):
 *   A  rules only
 *   B  rules + LLM fallback          (LLM = scripted MOCK)
 *   C  rules + Jev + LLM fallback    (Jev and LLM = scripted MOCKS)
 *
 * Field-level accuracy is measured against hand-written expectations below:
 * each expectation is either the value that should be filled, or "human"
 * (the field must be left for the person). Mock tiers make no network calls;
 * their call counts are real (calls the engine made) but tokens/cost are
 * estimates and are labelled as such. No real-model performance is claimed.
 */
import fs from "node:fs";
import path from "node:path";

import type { Browser } from "playwright";

import { JevProvider, type JevClient } from "~/lib/apply/decision/jev";
import { LlmProvider, ScriptedLlm } from "~/lib/apply/decision/llm";
import { RuleProvider } from "~/lib/apply/decision/rules";
import type { DecisionProvider } from "~/lib/apply/decision/types";
import type { CandidateProfile } from "~/lib/profile/schema";
import type { FieldReport } from "~/server/apply/run";
import { runApplication } from "~/server/workflow/run-application";
import { launch, startFixtureServer, syntheticProfile, writeResumeFile } from "../tests/helpers/apply-harness";

type Expect = Record<string, string | "human">; // label regex source -> expected value or "human"

const FORMS: { file: string; expect: Expect }[] = [
  { file: "basic.html", expect: { "^First name": "Avery", "^Last name": "Quinn", "^Email": "avery.quinn@example.com", "^LinkedIn": "https://linkedin.com/in/avery-quinn-demo", "^Years of experience": "6-9" } },
  {
    file: "ambiguous.html",
    expect: {
      "^Name$": "Avery Quinn",
      "^Email address": "avery.quinn@example.com",
      "Country of residence": "Australia",
      "authorized to work": "Yes",
      sponsorship: "No",
      "Expected salary": "150000",
      "Current salary": "human",
      "^Gender": "human",
      "AI assistant": "human",
      "privacy policy": "human",
      Kubernetes: "human",
    },
  },
  { file: "full-application.html", expect: { "^First name": "Avery", "^Location \\(City\\)": "Melbourne", "authorized to work": "Yes", sponsorship: "No", "How did you hear": "LinkedIn", "How many years": "5-7", "^Gender": "human", "Veteran": "human", "privacy policy": "human", "Years of experience with TypeScript": "human" } },
  { file: "multi-step.html", expect: { "^First name": "Avery", "Country of residence": "Australia", "How did you hear": "LinkedIn", "authorised to work": "Yes", "terms and conditions": "human" } },
  { file: "dynamic.html", expect: { "^Email": "avery.quinn@example.com", "How did you hear": "LinkedIn", "^Phone": "+61400555123" } },
  { file: "iframe.html", expect: { "^First name": "Avery", "^Email": "avery.quinn@example.com" } },
  { file: "trap.html", expect: { "^First name": "Avery", "^Email": "avery.quinn@example.com" } },
  { file: "greenhouse-like.html", expect: { "^First Name": "Avery", "legally authorized": "Yes", sponsorship: "No", "How did you hear": "LinkedIn", "^Gender": "human" } },
  { file: "lever-like.html", expect: { "^Full name": "Avery Quinn", "^Current company": "Northwind Labs", "right to work": "Yes", "Which office": "human" } },
  { file: "ashby-like.html", expect: { "^Name$": "Avery Quinn", "authorized to work": "Yes", "visa sponsorship": "No" } },
  {
    file: "jev-ambiguous.html",
    expect: {
      "Highest level of education": "Bachelor's degree",
      "cloud platform": "AWS",
      "primary engineering focus": "Frontend / full-stack web",
      "automated testing": "Built test frameworks or suites",
      "Which team": "human",
      "work arrangement": "human",
    },
  },
];

/** MOCK LLM: answers only what a profile-grounded model plausibly could. */
const mockLlm = () =>
  new ScriptedLlm((fields) =>
    fields.map((f) => {
      if (/why/i.test(f.label) && !f.options?.length) return { id: f.id, value: "I build reliable TypeScript platforms.", confidence: 0.8, needs_confirmation: true };
      if (/country/i.test(f.label) && f.options?.includes("Australia")) return { id: f.id, value: "Australia", confidence: 0.9 };
      return { id: f.id, value: "", confidence: 0 };
    }),
  );

/**
 * ORACLE MOCK Jev (upper bound, NOT a model): answers bounded-choice fields
 * with the benchmark's expected answer when one exists, abstains otherwise.
 * It measures how much a perfect constrained-choice tier could take off the
 * LLM / the person, and what that costs in calls. It says nothing about real
 * Jev accuracy.
 */
const oracleJev = (): JevClient => ({
  decide: async (reqs) => {
    const truth = Object.assign({}, ...FORMS.map((f) => f.expect)) as Expect;
    return {
      responses: reqs.map((r) => {
        const hit = Object.entries(truth).find(([re]) => new RegExp(re, "i").test(r.label));
        const i = hit && hit[1] !== "human" ? r.options.indexOf(hit[1]) : -1;
        return { fieldId: r.fieldId, choice: i, confidence: i >= 0 ? 0.95 : 0 };
      }),
    };
  },
});

const CONFIGS: Record<string, () => DecisionProvider[]> = {
  "A rules": () => [new RuleProvider()],
  "B rules+LLM(mock)": () => [new RuleProvider(), new LlmProvider(mockLlm())],
  "C rules+Jev(ORACLE upper bound)+LLM(mock)": () => [new RuleProvider(), new JevProvider(oracleJev()), new LlmProvider(mockLlm())],
};

function score(fields: FieldReport[], expect: Expect) {
  let correct = 0;
  const misses: string[] = [];
  for (const [re, want] of Object.entries(expect)) {
    const f = fields.find((x) => new RegExp(re, "i").test(x.label));
    const ok = !!f && (want === "human" ? f.outcome === "needs_human" : f.outcome === "verified" && String(f.value).replace(/\s+/g, "") === want.replace(/\s+/g, ""));
    if (ok) correct++;
    else misses.push(`${re} -> ${f ? `${f.outcome}${f.value !== undefined ? `:${String(f.value)}` : ""}` : "not found"}`);
  }
  return { correct, total: Object.keys(expect).length, misses };
}

async function runOne(browser: Browser, url: string, origin: string, profile: CandidateProfile, resume: { bytes: Uint8Array; kind: "pdf"; filename: string }, providers: DecisionProvider[]) {
  return runApplication({ formUrl: url, profile, resume, providers, allowedOrigins: [origin], browser });
}

async function main() {
  const [browser, server, resumePath] = await Promise.all([launch(), startFixtureServer(), writeResumeFile()]);
  const resume = { bytes: new Uint8Array(fs.readFileSync(resumePath)), kind: "pdf" as const, filename: "resume.pdf" };
  const profile = syntheticProfile();
  profile.contact.phone = { value: "+61400555123", source: "user", confidence: 1 }; // digits-only so multi-step validation passes
  const rows: Record<string, string | number>[] = [];
  type Totals = { correct: number; total: number; calls: number; fields: number; human: number; fallback: number; failures: number; actions: number; ms: number[]; jev: number };
  const totals: Record<string, Totals> = {};
  const misses: Record<string, string[]> = {};
  try {
    for (const [name, providers] of Object.entries(CONFIGS)) {
      const t: Totals = { correct: 0, total: 0, calls: 0, fields: 0, human: 0, fallback: 0, failures: 0, actions: 0, ms: [], jev: 0 };
      totals[name] = t;
      for (const form of FORMS) {
        const durations: number[] = [];
        let last: Awaited<ReturnType<typeof runOne>> | null = null;
        for (let i = 0; i < 3; i++) {
          const p = providers();
          last = await runOne(browser, `${server.url}/${form.file}`, server.url, profile, resume, p);
          durations.push(last.report.metrics.durationMs);
        }
        const r = last!.report;
        const s = score(r.fields, form.expect);
        const m = r.metrics;
        const jev = m.byTier.jev ?? 0;
        const llmDecided = m.byTier.llm ?? 0;
        const med = durations.sort((a, b) => a - b)[1]!;
        t.correct += s.correct;
        t.total += s.total;
        t.calls += m.llmCalls;
        t.fields += m.fields;
        t.human += m.needsHuman;
        t.fallback += jev + llmDecided;
        t.jev += jev;
        t.failures += m.errors + m.mismatches;
        t.actions += m.browserActions;
        t.ms.push(med);
        if (s.misses.length) misses[`${name} / ${form.file}`] = s.misses;
        rows.push({
          config: name,
          form: form.file,
          accuracy: `${s.correct}/${s.total}`,
          verified: `${m.verified}/${m.fields}`,
          requiredDone: `${Math.round(m.requiredCompletion * 100)}%`,
          manual: m.needsHuman,
          verifyFail: m.errors + m.mismatches,
          byJev: jev,
          byLlm: llmDecided,
          llmCalls: m.llmCalls,
          actions: m.browserActions,
          medianMs: Math.round(med),
          posted: server.posts.length,
        });
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }

  console.table(rows);
  const summary = Object.entries(totals).map(([name, t]) => ({
    config: name,
    fieldAccuracy: `${t.correct}/${t.total} (${Math.round((100 * t.correct) / t.total)}%)`,
    manualReviewRate: `${Math.round((100 * t.human) / t.fields)}%`,
    fallbackRate: `${Math.round((100 * t.fallback) / t.fields)}% of fields`,
    verificationFailures: t.failures,
    llmCalls: t.calls,
    browserActions: t.actions,
    totalMedianMs: Math.round(t.ms.reduce((a, b) => a + b, 0)),
    byJev: t.jev,
  }));
  console.table(summary);
  if (Object.keys(misses).length) console.log("Accuracy misses:", misses);

  const outDir = path.resolve(import.meta.dirname, "../bench-results");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const note = "LLM tier is a scripted MOCK and the Jev tier is an ORACLE MOCK (upper bound: it knows the expected answers). No network. Call counts are real; tokens/cost are not measured. Durations are local headless Chromium on synthetic forms, excluding any real model latency. Config C shows the opportunity for a constrained-choice tier, not real Jev accuracy.";
  fs.writeFileSync(path.join(outDir, `apply-${stamp}.json`), JSON.stringify({ note, rows, summary, misses }, null, 2));
  console.log(`\n${note}\nSaved bench-results/apply-${stamp}.json`);
  if (rows.some((r) => r.posted !== 0)) {
    console.error("FAIL: a form submission reached the server");
    process.exit(1);
  }
}

void main();
