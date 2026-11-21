import { LlmProvider, type LlmClient } from "~/lib/apply/decision/llm";
import type { DecisionProvider } from "~/lib/apply/decision/types";
import { ANTHROPIC_PRICING, AnthropicLlm } from "./anthropic";
import { createMockLlm } from "./mock";
import { TypeSafeJevClient } from "./typesafe-jev";
import { JevProvider } from "~/lib/apply/decision/jev";

/**
 * LLM fallback tier from configuration. LLM_PROVIDER:
 *   unset/"none" -> no LLM tier (rules only)
 *   "mock"       -> scripted mock (refused in production)
 *   "anthropic"  -> Claude via the official SDK. Requires APPLY_LLM_API_KEY and
 *                   LLM_ALLOW_PAID_CALLS=1, so a developer's own ANTHROPIC_API_KEY
 *                   is never picked up by accident and no paid call happens silently.
 *                   Optional: LLM_MODEL (default claude-opus-5-5), LLM_EFFORT,
 *                   LLM_TIMEOUT_MS, LLM_MAX_CALLS_PER_RUN.
 */
/**
 * The LLM client behind the fallback tier, with the same safety gates, or null when no LLM is
 * configured. Used by option suggestions (choose among real form options only).
 */
export function createLlmClient(env: NodeJS.ProcessEnv): LlmClient | null {
  const p = env.LLM_PROVIDER ?? "none";
  if (p === "none") return null;
  if (p === "mock") {
    if (env.NODE_ENV === "production") throw new Error("LLM_PROVIDER=mock is not allowed in production.");
    return createMockLlm();
  }
  if (p === "anthropic") {
    if (env.LLM_ALLOW_PAID_CALLS !== "1") throw new Error("LLM_PROVIDER=anthropic makes paid API calls; set LLM_ALLOW_PAID_CALLS=1 to confirm.");
    const apiKey = env.APPLY_LLM_API_KEY?.trim();
    if (!apiKey) throw new Error("LLM_PROVIDER=anthropic needs APPLY_LLM_API_KEY (server-side only).");
    const effort = (["low", "medium", "high"] as const).find((e) => e === env.LLM_EFFORT) ?? "low";
    return new AnthropicLlm({ apiKey, model: env.LLM_MODEL ?? "claude-opus-5-5", effort, timeoutMs: Number(env.LLM_TIMEOUT_MS ?? 30_000) });
  }
  throw new Error(`Unknown LLM_PROVIDER "${p}".`);
}

export function createLlmProviders(env: NodeJS.ProcessEnv): DecisionProvider[] {
  const p = env.LLM_PROVIDER ?? "none";
  if (p === "none") return [];
  if (p === "mock") {
    if (env.NODE_ENV === "production") throw new Error("LLM_PROVIDER=mock is not allowed in production.");
    return [new LlmProvider(createMockLlm(), { maxCallsPerRun: 2 })];
  }
  if (p === "anthropic") {
    if (env.LLM_ALLOW_PAID_CALLS !== "1") throw new Error("LLM_PROVIDER=anthropic makes paid API calls; set LLM_ALLOW_PAID_CALLS=1 to confirm.");
    const apiKey = env.APPLY_LLM_API_KEY?.trim();
    if (!apiKey) throw new Error("LLM_PROVIDER=anthropic needs APPLY_LLM_API_KEY (server-side only).");
    const model = env.LLM_MODEL ?? "claude-opus-5-5";
    const effort = (["low", "medium", "high"] as const).find((e) => e === env.LLM_EFFORT) ?? "low";
    const client = new AnthropicLlm({ apiKey, model, effort, timeoutMs: Number(env.LLM_TIMEOUT_MS ?? 30_000) });
    return [new LlmProvider(client, { pricing: ANTHROPIC_PRICING[model], maxCallsPerRun: Number(env.LLM_MAX_CALLS_PER_RUN ?? 2) })];
  }
  throw new Error(`Unknown LLM_PROVIDER "${p}".`);
}

/**
 * Optional Jev tier (runs after rules, before the LLM). JEV_PROVIDER:
 *   unset/"none" -> no Jev tier
 *   "typesafe"   -> TypeSafe API; requires APPLY_JEV_API_KEY and JEV_ALLOW_PAID_CALLS=1.
 *                   Optional JEV_MODEL (pin a version), JEV_MIN_CONFIDENCE.
 */
export function createJevProviders(env: NodeJS.ProcessEnv): DecisionProvider[] {
  const p = env.JEV_PROVIDER ?? "none";
  if (p === "none") return [];
  if (p !== "typesafe") throw new Error(`Unknown JEV_PROVIDER "${p}".`);
  if (env.JEV_ALLOW_PAID_CALLS !== "1") throw new Error("JEV_PROVIDER=typesafe makes paid API calls; set JEV_ALLOW_PAID_CALLS=1 to confirm.");
  const apiKey = env.APPLY_JEV_API_KEY?.trim();
  if (!apiKey) throw new Error("JEV_PROVIDER=typesafe needs APPLY_JEV_API_KEY (server-side only).");
  const client = new TypeSafeJevClient({ apiKey, model: env.JEV_MODEL });
  // Vendor homepage list price: $42 per billion input tokens; output pricing not documented (treated as 0).
  return [new JevProvider(client, { minConfidence: Number(env.JEV_MIN_CONFIDENCE ?? 0.8), pricing: { inputPerMTok: 0.042, outputPerMTok: 0 } })];
}
