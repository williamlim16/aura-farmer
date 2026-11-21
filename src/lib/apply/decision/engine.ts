/**
 * Tiered decision engine: rules -> Jev -> LLM, then a final safety guard that
 * no tier can bypass. Records which tier decided each field and per-tier
 * latency/usage, which is what the benchmark reports.
 */
import { classifyField } from "../classify";
import { ALWAYS_HUMAN_KINDS, type Classification, type Decision, type DecisionTier, type FormField } from "../types";
import type { DecisionContext, DecisionInput, DecisionProvider, ProviderUsage } from "./types";

export interface FieldDecision {
  field: FormField;
  classification: Classification;
  decision: Decision;
}

export interface DecisionRunStats {
  byTier: Record<DecisionTier | "guard" | "none", number>;
  tierMs: Partial<Record<DecisionTier, number>>;
  usage: Partial<Record<DecisionTier, ProviderUsage>>;
}

const GUARD_REASON: Record<string, string> = {
  eeo: "Demographic / EEO question: answered by you only.",
  legal: "Legal history question: answered by you only.",
  salary_history: "Salary history question: answered by you only.",
  consent: "Consent / attestation: you must tick this yourself.",
  ai_directed: "Question addressed to an AI: answer it yourself or leave it blank.",
  third_party: "Asks about another person (referrer/reference): not in your profile.",
};

/** Final guard. Runs after every tier, so even an LLM answer cannot reach these fields. */
export function guardDecision(cls: Classification, d: Decision, field: FormField): Decision {
  // An answer the user explicitly typed for this exact question is the human's
  // own answer; it may fill sensitive fields (EEO, consent). Only the rule tier
  // sets userProvided, so no model output can take this path.
  if (d.action === "fill" && d.tier === "rule" && d.userProvided === true) return d;
  if (ALWAYS_HUMAN_KINDS.has(cls.kind)) {
    return { action: "human", reason: GUARD_REASON[cls.kind] ?? "Sensitive field.", tier: "guard" };
  }
  if (d.action === "fill" && field.control === "checkbox" && d.tier !== "rule") {
    return { action: "human", reason: "Checkbox suggested by a non-rule tier needs your confirmation.", tier: "guard" };
  }
  return d;
}

export class DecisionEngine {
  constructor(private readonly providers: DecisionProvider[]) {}

  async decide(fields: FormField[], ctx: DecisionContext): Promise<{ decisions: FieldDecision[]; stats: DecisionRunStats }> {
    const stats: DecisionRunStats = { byTier: { rule: 0, jev: 0, llm: 0, guard: 0, none: 0 }, tierMs: {}, usage: {} };
    const inputs: DecisionInput[] = fields.map((field) => ({ field, classification: classifyField(field) }));
    const decided = new Map<string, Decision>();

    // Sensitive fields never reach any provider, so they are never sent to an LLM.
    let pending = inputs.filter((i) => !ALWAYS_HUMAN_KINDS.has(i.classification.kind));

    for (const p of this.providers) {
      if (!pending.length) break;
      const t0 = performance.now();
      const got = await p.decideMany(pending, ctx);
      stats.tierMs[p.tier] = (stats.tierMs[p.tier] ?? 0) + (performance.now() - t0);
      for (const [id, d] of got) decided.set(id, d);
      pending = pending.filter((i) => !decided.has(i.field.id));
    }
    for (const p of this.providers) if (p.usage) stats.usage[p.tier] = p.usage();

    const decisions = inputs.map(({ field, classification }) => {
      const raw: Decision = decided.get(field.id) ?? { action: "human", reason: "No tier could answer this field.", tier: "guard" };
      const decision = guardDecision(classification, raw, field);
      const key = decided.has(field.id) && decision.tier !== "guard" ? decision.tier : decision.tier === "guard" ? "guard" : "none";
      stats.byTier[key]++;
      return { field, classification, decision };
    });
    return { decisions, stats };
  }
}
