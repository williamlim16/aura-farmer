import type { Page } from "playwright";

import type { DecisionEngine, FieldDecision } from "~/lib/apply/decision/engine";
import type { DecisionContext, ProviderUsage } from "~/lib/apply/decision/types";
import type { DecisionTier, FieldOutcome } from "~/lib/apply/types";
import { extractForm } from "./extract-form";
import { fillFields } from "./fill";
import type { SubmitGuard } from "./submit-guard";
import { matches, readBack } from "./verify";

export interface FieldReport {
  id: string;
  label: string;
  control: string;
  kind: string;
  required: boolean;
  tier: DecisionTier | "guard";
  outcome: FieldOutcome;
  value?: string | boolean;
  reason?: string;
  reviewRequired?: boolean;
  round: number;
}

export interface AutofillReport {
  /** Always true: this engine has no submit capability. */
  stoppedBeforeSubmit: true;
  fields: FieldReport[];
  metrics: {
    fields: number;
    required: number;
    verified: number;
    requiredVerified: number;
    needsHuman: number;
    errors: number;
    mismatches: number;
    /** verified / fields that were attempted (fill or upload). */
    fillAccuracy: number;
    /** required fields verified / required fields. */
    requiredCompletion: number;
    rounds: number;
    durationMs: number;
    decisionMs: number;
    llmCalls: number;
    llmInputTokens: number;
    llmOutputTokens: number;
    llmCostUsd: number;
    byTier: Record<string, number>;
  };
  blockedSubmits: { inPage: number; network: number };
}

/**
 * Extract -> decide -> fill -> verify, repeated while new fields appear
 * (conditional / delayed sections), up to `maxRounds`. Never submits.
 */
export async function runAutofill(
  page: Page,
  engine: DecisionEngine,
  ctx: DecisionContext,
  opts: { resumePath: string | null; guard: SubmitGuard; maxRounds?: number; settleMs?: number },
): Promise<AutofillReport> {
  const t0 = performance.now();
  const all: (FieldDecision & { round: number; fillOk?: boolean; fillErr?: string })[] = [];
  const seen = new Set<string>();
  let decisionMs = 0;
  const byTier: Record<string, number> = {};
  const usage: Partial<Record<DecisionTier, ProviderUsage>> = {};
  let round = 0;

  while (round < (opts.maxRounds ?? 3)) {
    round++;
    const fields = (await extractForm(page)).filter((f) => !seen.has(f.id));
    if (!fields.length) break;
    fields.forEach((f) => seen.add(f.id));

    const td = performance.now();
    const { decisions, stats } = await engine.decide(fields, ctx);
    decisionMs += performance.now() - td;
    for (const [k, v] of Object.entries(stats.byTier)) byTier[k] = (byTier[k] ?? 0) + v;
    Object.assign(usage, stats.usage); // providers report cumulative usage

    const results = await fillFields(page, decisions, { resumePath: opts.resumePath });
    for (const d of decisions) {
      const r = results.find((x) => x.id === d.field.id);
      all.push({ ...d, round, fillOk: r?.ok, fillErr: r?.error });
    }
    await page.waitForTimeout(opts.settleMs ?? 400); // let conditional fields render
  }

  const rb = await readBack(page, all.map((a) => a.field.id));
  const fields: FieldReport[] = all.map((a) => {
    const d = a.decision;
    let outcome: FieldOutcome;
    if (d.action === "human") outcome = "needs_human";
    else if (d.action === "skip") outcome = "skipped";
    else if (a.fillOk === false) outcome = "error";
    else outcome = matches(a, rb.get(a.field.id)) ? "verified" : "mismatch";
    return {
      id: a.field.id,
      label: a.field.label,
      control: a.field.control,
      kind: a.classification.kind,
      required: a.field.required,
      tier: d.tier,
      outcome,
      ...(d.action === "fill" ? { value: d.value, reviewRequired: d.reviewRequired } : {}),
      ...(d.action === "human" || d.action === "skip" ? { reason: d.reason } : {}),
      ...(a.fillErr ? { reason: a.fillErr } : {}),
      round: a.round,
    };
  });

  const attempted = fields.filter((f) => f.outcome === "verified" || f.outcome === "mismatch" || f.outcome === "error");
  const required = fields.filter((f) => f.required);
  const verified = fields.filter((f) => f.outcome === "verified");
  const llm = usage.llm;
  return {
    stoppedBeforeSubmit: true,
    fields,
    metrics: {
      fields: fields.length,
      required: required.length,
      verified: verified.length,
      requiredVerified: required.filter((f) => f.outcome === "verified").length,
      needsHuman: fields.filter((f) => f.outcome === "needs_human").length,
      errors: fields.filter((f) => f.outcome === "error").length,
      mismatches: fields.filter((f) => f.outcome === "mismatch").length,
      fillAccuracy: attempted.length ? verified.length / attempted.length : 1,
      requiredCompletion: required.length ? required.filter((f) => f.outcome === "verified").length / required.length : 1,
      rounds: round,
      durationMs: performance.now() - t0,
      decisionMs,
      llmCalls: llm?.calls ?? 0,
      llmInputTokens: llm?.inputTokens ?? 0,
      llmOutputTokens: llm?.outputTokens ?? 0,
      llmCostUsd: llm?.costUsd ?? 0,
      byTier,
    },
    blockedSubmits: { inPage: await opts.guard.blockedInPage(page), network: opts.guard.blockedNetwork.length },
  };
}
