/**
 * Autofill benchmark over the local synthetic fixtures.
 *
 *   pnpm bench:apply
 *
 * Configurations:
 *   rules        — deterministic tier only (no model)
 *   rules+llm    — rules, then one batched call to a SCRIPTED MOCK LLM
 *
 * Every number for the LLM tier is MOCKED: call counts are real (they count
 * calls the engine made), token counts are ESTIMATES (~4 chars/token) from the
 * prompt the engine built, and latency excludes any real model time. No real
 * API was called. Real-model results require plugging in an LlmClient.
 */
import fs from "node:fs";
import path from "node:path";

import { LlmProvider, ScriptedLlm } from "~/lib/apply/decision/llm";
import { RuleProvider } from "~/lib/apply/decision/rules";
import type { DecisionProvider } from "~/lib/apply/decision/types";
import { autofillFixture, launch, startFixtureServer, writeResumeFile } from "../tests/helpers/apply-harness";

const FORMS = ["basic.html", "ambiguous.html", "dynamic.html", "trap.html"];

// Mock answers only what a profile-grounded model plausibly could; abstains otherwise.
const mockLlm = () =>
  new ScriptedLlm((fields) =>
    fields.map((f) =>
      /why do you want/i.test(f.label)
        ? { id: f.id, value: "I build reliable TypeScript platforms.", confidence: 0.8 }
        : /country/i.test(f.label)
          ? { id: f.id, value: "Australia", confidence: 0.9 }
          : { id: f.id, value: "", confidence: 0 },
    ),
  );

const configs: Record<string, () => DecisionProvider[]> = {
  rules: () => [new RuleProvider()],
  "rules+llm(mock)": () => [new RuleProvider(), new LlmProvider(mockLlm())],
};

async function main() {
  const [browser, server, resumePath] = await Promise.all([launch(), startFixtureServer(), writeResumeFile()]);
  const rows: Record<string, string | number>[] = [];
  try {
    for (const [name, providers] of Object.entries(configs)) {
      for (const form of FORMS) {
        const runs: Awaited<ReturnType<typeof autofillFixture>>["report"][] = [];
        for (let i = 0; i < 3; i++) {
          const { report, context } = await autofillFixture(browser, server, form, { resumePath, providers: providers() });
          runs.push(report);
          await context.close();
        }
        const r = runs.at(-1)!;
        const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
        rows.push({
          config: name,
          form,
          fields: r.metrics.fields,
          verified: r.metrics.verified,
          needsHuman: r.metrics.needsHuman,
          errors: r.metrics.errors + r.metrics.mismatches,
          requiredCompletion: `${(r.metrics.requiredCompletion * 100).toFixed(0)}%`,
          fillAccuracy: `${(r.metrics.fillAccuracy * 100).toFixed(0)}%`,
          modelCalls: r.metrics.llmCalls,
          estTokens: r.metrics.llmInputTokens + r.metrics.llmOutputTokens,
          medianMs: Math.round(median(runs.map((x) => x.metrics.durationMs))),
          submitsBlocked: r.blockedSubmits.inPage + r.blockedSubmits.network,
          posted: server.posts.length,
        });
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  console.table(rows);
  const outDir = path.resolve(import.meta.dirname, "../bench-results");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `apply-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify({ note: "LLM tier is a scripted mock; tokens are estimates; no real API calls.", rows }, null, 2));
  console.log(`\nSaved ${path.relative(process.cwd(), file)}`);
  if (rows.some((r) => r.posted !== 0)) {
    console.error("FAIL: a form submission reached the server");
    process.exit(1);
  }
}

void main();
