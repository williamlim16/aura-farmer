import { LlmProvider } from "~/lib/apply/decision/llm";
import type { DecisionProvider } from "~/lib/apply/decision/types";
import { createMockLlm } from "./mock";

/**
 * LLM fallback tier from configuration. LLM_PROVIDER:
 *   unset/"none" -> no LLM tier (rules only)
 *   "mock"       -> scripted mock (refused in production)
 */
export function createLlmProviders(env: NodeJS.ProcessEnv): DecisionProvider[] {
  const p = env.LLM_PROVIDER ?? "none";
  if (p === "none") return [];
  if (p === "mock") {
    if (env.NODE_ENV === "production") throw new Error("LLM_PROVIDER=mock is not allowed in production.");
    return [new LlmProvider(createMockLlm(), { maxCallsPerRun: 2 })];
  }
  throw new Error(`Unknown LLM_PROVIDER "${p}".`);
}
