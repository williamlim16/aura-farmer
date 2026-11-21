/**
 * TypeSafe Jev client against a FAKE fetch built from the documented request
 * and response shapes (docs.typesafe.ai quickstart + choice primitive).
 * Not validated against the real API (no key available).
 */
import { describe, expect, it } from "vitest";

import { classifyField } from "~/lib/apply/classify";
import { DecisionEngine } from "~/lib/apply/decision/engine";
import { JevProvider } from "~/lib/apply/decision/jev";
import { RuleProvider } from "~/lib/apply/decision/rules";
import type { FormField } from "~/lib/apply/types";
import { createJevProviders } from "~/server/llm/factory";
import { TypeSafeJevClient } from "~/server/llm/typesafe-jev";
import { syntheticProfile } from "../helpers/apply-harness";

const f = (id: string, label: string, options: string[], control: FormField["control"] = "select"): FormField => ({
  id, control, label, labelSource: "label-for", name: "", htmlId: "", placeholder: "", autocomplete: "", required: false, options, multiple: false, accept: "",
});

type Body = { model: string; state: string; questions: Record<string, { type: string; instructions: string; criteria: Record<string, string> }> };

function fake(answer: (b: Body) => unknown, status = 200) {
  const calls: { body: Body; headers: Headers; url: string }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Body;
    calls.push({ body, headers: new Headers(init?.headers), url: String(url) });
    return new Response(JSON.stringify(answer(body)), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fn, calls };
}

const ctx = () => ({ profile: syntheticProfile(), hasResume: true });

describe("TypeSafeJevClient (fake fetch, documented shapes)", () => {
  it("sends one batched choice request with index-keyed options and a 'none' escape", async () => {
    const { fn, calls } = fake((b) => ({
      model: "jev-1.13.0",
      answers: Object.fromEntries(Object.keys(b.questions).map((q) => [q, { type: "choice", choice: "1", confidence: 0.93, probabilities: { "0": 0.04, "1": 0.93, none: 0.03 } }])),
      usage: { input_tokens: 420, output_tokens: 3 },
    }));
    const provider = new JevProvider(new TypeSafeJevClient({ apiKey: "jev-test", fetch: fn }), { pricing: { inputPerMTok: 0.042, outputPerMTok: 0 } });
    const fields = [f("a", "Preferred office", ["Sydney", "Melbourne"]), f("b", "Team", ["Platform", "Payments"])];
    const out = await provider.decideMany(fields.map((x) => ({ field: x, classification: classifyField(x) })), ctx());

    expect(calls).toHaveLength(1);
    const { body, headers, url } = calls[0]!;
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(headers.get("authorization")).toBe("Bearer jev-test");
    expect(body.model).toBe("jev-latest");
    expect(Object.keys(body.questions)).toHaveLength(2);
    expect(body.questions.f0).toMatchObject({ type: "choice", criteria: { "0": "Sydney", "1": "Melbourne", none: expect.any(String) } });
    for (const pii of ["avery.quinn@example.com", "+61", "Avery Quinn", "linkedin"]) expect(JSON.stringify(body)).not.toContain(pii);

    expect(out.get("a")).toMatchObject({ action: "fill", tier: "jev", value: "Melbourne", confidence: 0.93 });
    expect(provider.usage()).toMatchObject({ calls: 1, inputTokens: 420, measured: true });
    expect(provider.usage().costUsd).toBeCloseTo((420 * 0.042) / 1e6, 12);
  });

  it("abstains on 'none', low confidence, out-of-range or malformed answers", async () => {
    const answers: Record<string, unknown> = {
      f0: { type: "choice", choice: "none", confidence: 0.9 },
      f1: { type: "choice", choice: "0", confidence: 0.4 },
      f2: { type: "choice", choice: "7", confidence: 0.99 },
      f3: { nonsense: true },
    };
    const { fn } = fake(() => ({ answers }));
    const provider = new JevProvider(new TypeSafeJevClient({ apiKey: "k", fetch: fn }));
    const fields = ["w", "x", "y", "z"].map((id) => f(id, `Q ${id}`, ["A", "B"]));
    const out = await provider.decideMany(fields.map((x) => ({ field: x, classification: classifyField(x) })), ctx());
    expect(out.size).toBe(0);
  });

  it("never sends free-text fields (Jev selects, it does not write)", async () => {
    const { fn, calls } = fake(() => ({ answers: {} }));
    const provider = new JevProvider(new TypeSafeJevClient({ apiKey: "k", fetch: fn }));
    const essay = f("e", "Why us?", [], "textarea");
    await provider.decideMany([{ field: essay, classification: classifyField(essay) }], ctx());
    expect(calls).toHaveLength(0);
  });

  it("falls through to the next tier when the API errors", async () => {
    const { fn, calls } = fake(() => ({ error: "boom" }), 503);
    const llmCalled: string[] = [];
    const nextTier = { tier: "llm" as const, name: "next", decideMany: async (ins: { field: FormField }[]) => { ins.forEach((i) => llmCalled.push(i.field.id)); return new Map(); } };
    const engine = new DecisionEngine([new RuleProvider(), new JevProvider(new TypeSafeJevClient({ apiKey: "k", fetch: fn, retries: 1 })), nextTier]);
    await engine.decide([f("o", "Preferred office", ["Sydney", "Melbourne"])], ctx());
    expect(calls).toHaveLength(2); // one retry
    expect(llmCalled).toEqual(["o"]);
  });

  it("requires explicit opt-in and a dedicated key", () => {
    expect(createJevProviders({} as unknown as NodeJS.ProcessEnv)).toEqual([]);
    expect(() => createJevProviders({ JEV_PROVIDER: "typesafe", APPLY_JEV_API_KEY: "k" } as unknown as NodeJS.ProcessEnv)).toThrow(/JEV_ALLOW_PAID_CALLS/);
    expect(() => createJevProviders({ JEV_PROVIDER: "typesafe", JEV_ALLOW_PAID_CALLS: "1" } as unknown as NodeJS.ProcessEnv)).toThrow(/APPLY_JEV_API_KEY/);
  });
});
