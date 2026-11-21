/**
 * Claude adapter for the LLM decision tier (official @anthropic-ai/sdk).
 *
 * - Structured output: the answer JSON schema is enforced server-side via
 *   output_config.format (json_schema); the provider still validates it.
 * - Server-side refusal fallback enabled ("default" routing).
 * - Bounded: per-request timeout and limited SDK retries (429/5xx/network);
 *   the per-run call budget lives in LlmProvider.
 * - Usage comes from the API response; cost is computed by LlmProvider from
 *   the configured price table. Nothing here is called by the test suite
 *   against the real API (tests inject a fake fetch).
 */
import Anthropic from "@anthropic-ai/sdk";

import type { LlmClient, LlmPricing, LlmRequest, LlmResponse } from "~/lib/apply/decision/llm";

/** USD per million tokens (Anthropic first-party list prices, cached 2026-11-03). */
export const ANTHROPIC_PRICING: Record<string, LlmPricing> = {
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20 },
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-haiku-5-5": { inputPerMTok: 0.1, outputPerMTok: 0.5 },
};

export class LlmRefusalError extends Error {
  constructor(readonly category: string | null) {
    super(`The model declined this request${category ? ` (${category})` : ""}.`);
    this.name = "LlmRefusalError";
  }
}

export interface AnthropicLlmOptions {
  apiKey: string;
  model?: string;
  effort?: "low" | "medium" | "high";
  timeoutMs?: number;
  maxRetries?: number;
  /** For tests: inject a fetch implementation. */
  fetch?: typeof fetch;
  baseURL?: string;
}

export class AnthropicLlm implements LlmClient {
  readonly model: string;
  private readonly client: Anthropic;
  private readonly effort: "low" | "medium" | "high";

  constructor(opts: AnthropicLlmOptions) {
    this.model = opts.model ?? "claude-opus-5-5";
    this.effort = opts.effort ?? "low"; // bounded classification/extraction task
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      timeout: opts.timeoutMs ?? 30_000,
      maxRetries: opts.maxRetries ?? 2,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: Math.max(1024, req.maxOutputTokens),
      system: req.system,
      messages: [{ role: "user", content: req.user }],
      output_config: {
        effort: this.effort,
        ...(req.outputSchema ? { format: { type: "json_schema", schema: req.outputSchema } } : {}),
      },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    if (response.stop_reason === "refusal") {
      throw new LlmRefusalError(response.stop_details?.category ?? null);
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error("The model response was cut off (max_tokens).");
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return {
      text,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      measured: true,
      servedBy: response.model,
    };
  }
}
