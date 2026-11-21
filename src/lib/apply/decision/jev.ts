/**
 * Tier B: "TypeSafe Jev" adapter.
 *
 * Provider-neutral contract for the Jev tier. A concrete client for TypeSafe's
 * documented API lives in src/server/llm/typesafe-jev.ts (untested against the
 * real service: no key yet). No benchmark numbers exist for real Jev.
 *
 * Intended use: cheap, typed decisions for ambiguous-but-bounded UI choices
 * (e.g. which option of a select matches "Australia", whether an unlabeled
 * field is "phone") where rules abstain but a full LLM call is overkill.
 * Implement `JevClient` once the real SDK is available and pass it in.
 */
import { z } from "zod";

import type { Decision } from "../types";
import type { DecisionContext, DecisionInput, DecisionProvider, ProviderUsage } from "./types";

export const jevRequestSchema = z.object({
  fieldId: z.string(),
  control: z.string(),
  label: z.string(),
  options: z.array(z.string()),
  /** The only profile values Jev may choose from: it selects, it never invents. */
  candidates: z.array(z.string()),
});
export type JevRequest = z.infer<typeof jevRequestSchema>;

export const jevResponseSchema = z.object({
  fieldId: z.string(),
  /** Index into `options` (select/radio) or `candidates` (text); -1 = abstain. */
  choice: z.number().int().min(-1),
  confidence: z.number().min(0).max(1),
});
export type JevResponse = z.infer<typeof jevResponseSchema>;

export interface JevResult {
  responses: unknown[];
  usage?: { inputTokens: number; outputTokens: number };
}

export interface JevClient {
  /** `context.facts`: minimal candidate facts (location but no name, email, phone or links). */
  decide(requests: JevRequest[], context?: { facts: Record<string, unknown> }): Promise<unknown[] | JevResult>;
}

/** Minimal candidate facts for selection decisions: location is included; name, email, phone and links are not. */
export function candidateFacts(ctx: DecisionContext): Record<string, unknown> {
  const p = ctx.profile;
  return {
    location: p.contact.location?.value,
    totalYearsExperience: p.totalYearsExperience?.value,
    currentTitle: p.experience[0]?.title,
    highlights: p.experience.slice(0, 2).flatMap((e) => e.bullets.slice(0, 3)),
    skills: p.skills.slice(0, 30),
    preferences: {
      workAuthorization: p.preferences.workAuthorization,
      needsSponsorship: p.preferences.needsSponsorship,
      willingToRelocate: p.preferences.willingToRelocate,
      referralSource: p.preferences.referralSource,
      noticePeriod: p.preferences.noticePeriod,
    },
  };
}

export class JevProvider implements DecisionProvider {
  readonly tier = "jev" as const;
  readonly name = "jev";
  private stats: ProviderUsage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };

  constructor(
    private readonly client: JevClient | null,
    private readonly opts: { minConfidence?: number; candidates?: (i: DecisionInput, c: DecisionContext) => string[]; pricing?: { inputPerMTok: number; outputPerMTok: number } } = {},
  ) {}

  usage() {
    return { ...this.stats };
  }

  async decideMany(inputs: DecisionInput[], ctx: DecisionContext) {
    const out = new Map<string, Decision>();
    if (!this.client || !inputs.length) return out; // not configured: abstain on everything
    const reqs: JevRequest[] = inputs.map((i) => ({
      fieldId: i.field.id,
      control: i.field.control,
      label: i.field.label,
      options: i.field.options,
      candidates: this.opts.candidates?.(i, ctx) ?? [],
    }));
    this.stats.calls++;
    let raw: unknown[];
    try {
      const result = await this.client.decide(reqs, { facts: candidateFacts(ctx) });
      if (Array.isArray(result)) raw = result;
      else {
        raw = result.responses;
        if (result.usage) {
          this.stats.inputTokens += result.usage.inputTokens;
          this.stats.outputTokens += result.usage.outputTokens;
          this.stats.measured = true;
          if (this.opts.pricing) this.stats.costUsd += (result.usage.inputTokens * this.opts.pricing.inputPerMTok + result.usage.outputTokens * this.opts.pricing.outputPerMTok) / 1e6;
        }
      }
    } catch {
      return out; // tier failure is non-fatal: fall through to the next tier
    }
    const min = this.opts.minConfidence ?? 0.8;
    for (const r of raw) {
      const parsed = jevResponseSchema.safeParse(r);
      if (!parsed.success) continue;
      const req = reqs.find((q) => q.fieldId === parsed.data.fieldId);
      if (!req || parsed.data.choice < 0 || parsed.data.confidence < min) continue;
      const pool = req.options.length ? req.options : req.candidates;
      const value = pool[parsed.data.choice];
      if (value === undefined) continue;
      out.set(req.fieldId, { action: "fill", value, tier: "jev", confidence: parsed.data.confidence });
    }
    return out;
  }
}
