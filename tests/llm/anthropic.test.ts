/**
 * The real Claude adapter (official SDK) against a FAKE fetch: no network, no
 * cost. Verifies the exact request we send and how responses, refusals,
 * rate limits and timeouts flow through the LLM decision tier.
 */
import { describe, expect, it } from "vitest";

import { classifyField } from "~/lib/apply/classify";
import { LlmProvider } from "~/lib/apply/decision/llm";
import type { FormField } from "~/lib/apply/types";
import { ANTHROPIC_PRICING, AnthropicLlm } from "~/server/llm/anthropic";
import { createLlmProviders } from "~/server/llm/factory";
import { syntheticProfile } from "../helpers/apply-harness";

const field = (id: string, label: string, p: Partial<FormField> = {}): FormField => ({
  id, control: "textarea", label, labelSource: "label-for", name: "", htmlId: "", placeholder: "", autocomplete: "", required: true, options: [], multiple: false, accept: "", ...p,
});

function apiMessage(text: string, extra: Record<string, unknown> = {}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    ...extra,
  };
}

function fakeFetch(handler: (body: Record<string, unknown>, headers: Headers, n: number) => Response | Promise<Response>) {
  const calls: { body: Record<string, unknown>; headers: Headers }[] = [];
  const f = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const headers = new Headers(init?.headers);
    calls.push({ body, headers });
    return handler(body, headers, calls.length);
  }) as typeof fetch;
  return { f, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_test", ...headers } });

const inputs = () => [field("q1", "Why do you want to work at Example Corp?"), field("q2", "Preferred office", { control: "select", options: ["Sydney", "Melbourne"] })].map((f) => ({ field: f, classification: classifyField(f) }));
const ctx = () => ({ profile: syntheticProfile(), hasResume: true, job: { title: "Engineer", company: "Example Corp" } });

describe("AnthropicLlm adapter (fake fetch)", () => {
  it("sends a structured-output request with fallbacks and no contact details", async () => {
    const answer = JSON.stringify({ answers: [{ id: "q1", value: "I enjoy building reliable platforms.", confidence: 0.8, needs_confirmation: true }, { id: "q2", value: "Melbourne", confidence: 0.9, needs_confirmation: false }] });
    const { f, calls } = fakeFetch(() => json(200, apiMessage(answer)));
    const provider = new LlmProvider(new AnthropicLlm({ apiKey: "test-key", fetch: f, maxRetries: 0 }), { pricing: ANTHROPIC_PRICING["claude-opus-5-5"] });
    const out = await provider.decideMany(inputs(), ctx());

    expect(calls).toHaveLength(1);
    const { body, headers } = calls[0]!;
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.fallbacks).toBe("default");
    expect(headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(headers.get("authorization")).toBe("Bearer test-key"); // SDK 1.x auth header
    expect((body.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    expect((body.output_config as { effort: string }).effort).toBe("low");
    expect(body).not.toHaveProperty("thinking"); // can't be disabled on this model; effort controls depth
    const sent = JSON.stringify(body);
    for (const pii of ["avery.quinn@example.com", "555", "linkedin.com", "github.com", "Avery Quinn"]) expect(sent).not.toContain(pii);

    expect(out.get("q1")).toMatchObject({ action: "fill", tier: "llm", reviewRequired: true });
    expect(out.get("q2")).toMatchObject({ action: "fill", value: "Melbourne" });
    const u = provider.usage();
    expect(u).toMatchObject({ calls: 1, inputTokens: 1000, outputTokens: 200, measured: true });
    expect(u.costUsd).toBeCloseTo((1000 * 4 + 200 * 20) / 1e6, 10);
  });

  it("turns a refusal into manual review, not an answer", async () => {
    const { f } = fakeFetch(() => json(200, apiMessage("", { content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: null } })));
    const provider = new LlmProvider(new AnthropicLlm({ apiKey: "k", fetch: f, maxRetries: 0 }));
    const out = await provider.decideMany(inputs(), ctx());
    expect(out.get("q1")).toMatchObject({ action: "human", reason: expect.stringContaining("declined") });
  });

  it("retries a rate limit once, then succeeds", async () => {
    const answer = JSON.stringify({ answers: [{ id: "q1", value: "x", confidence: 0.9, needs_confirmation: true }] });
    const { f, calls } = fakeFetch((_b, _h, n) => (n === 1 ? json(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, { "retry-after-ms": "10" }) : json(200, apiMessage(answer))));
    const provider = new LlmProvider(new AnthropicLlm({ apiKey: "k", fetch: f, maxRetries: 2 }));
    const out = await provider.decideMany(inputs().slice(0, 1), ctx());
    expect(calls).toHaveLength(2);
    expect(out.get("q1")).toMatchObject({ action: "fill" });
  });

  it("times out and falls back to manual review", async () => {
    const hang = (async (_u: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))) as typeof fetch;
    const provider = new LlmProvider(new AnthropicLlm({ apiKey: "k", fetch: hang, timeoutMs: 100, maxRetries: 0 }));
    const out = await provider.decideMany(inputs(), ctx());
    expect(out.get("q1")).toMatchObject({ action: "human", reason: expect.stringContaining("LLM unavailable") });
  });

  it("rejects invalid structured output defensively", async () => {
    const { f } = fakeFetch(() => json(200, apiMessage("not json")));
    const provider = new LlmProvider(new AnthropicLlm({ apiKey: "k", fetch: f, maxRetries: 0 }));
    const out = await provider.decideMany(inputs(), ctx());
    expect(out.get("q1")).toMatchObject({ action: "human", reason: "LLM returned invalid output." });
  });
});

describe("LLM provider configuration", () => {
  it("never enables paid calls implicitly", () => {
    expect(() => createLlmProviders({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-dev" } as unknown as NodeJS.ProcessEnv)).toThrow(/LLM_ALLOW_PAID_CALLS/);
    expect(() => createLlmProviders({ LLM_PROVIDER: "anthropic", LLM_ALLOW_PAID_CALLS: "1", ANTHROPIC_API_KEY: "sk-dev" } as unknown as NodeJS.ProcessEnv)).toThrow(/APPLY_LLM_API_KEY/);
    const ok = createLlmProviders({ LLM_PROVIDER: "anthropic", LLM_ALLOW_PAID_CALLS: "1", APPLY_LLM_API_KEY: "k" } as unknown as NodeJS.ProcessEnv);
    expect(ok[0]!.name).toBe("llm:claude-opus-5-5");
  });
  it("refuses the mock in production and defaults to no LLM", () => {
    expect(() => createLlmProviders({ LLM_PROVIDER: "mock", NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toThrow();
    expect(createLlmProviders({} as unknown as NodeJS.ProcessEnv)).toEqual([]);
  });
});
