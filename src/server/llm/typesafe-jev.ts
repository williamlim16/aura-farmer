/**
 * TypeSafe "Jev" (System One model) client for the Jev decision tier.
 *
 * Implemented against the public docs (docs.typesafe.ai: quickstart, choice
 * primitive), checked 2026-11-21:
 *   POST https://api.typesafe.ai/v1/systemone   Authorization: Bearer <key>
 *   { state, model, questions: { [id]: { type: "choice", instructions, criteria: { [option]: description } } } }
 *   -> { model, answers: { [id]: { type: "choice", choice, probabilities, confidence } }, usage: { input_tokens, output_tokens } }
 * A choice question accepts up to 255 options; all questions are answered in
 * one call against the same state.
 *
 * STATUS: not exercised against the real API (no key available). Tests use a
 * fake fetch built from the documented shapes. Every response is validated;
 * anything unexpected makes the tier abstain, falling through to the LLM/human.
 */
import { z } from "zod";

import type { JevClient, JevRequest, JevResult } from "~/lib/apply/decision/jev";

const NONE = "none";
const MAX_OPTIONS = 254; // + the "none" option = 255

const answerSchema = z.object({
  choice: z.string(),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number()).optional(),
});
const responseSchema = z.object({
  model: z.string().optional(),
  answers: z.record(z.string(), z.unknown()),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).partial().optional(),
});

export interface TypeSafeJevOptions {
  apiKey: string;
  model?: string; // pin a version in production, e.g. "jev-1.14.0"
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  fetch?: typeof fetch;
}

const qid = (i: number) => `f${i}`;

export class TypeSafeJevClient implements JevClient {
  readonly model: string;
  constructor(private readonly o: TypeSafeJevOptions) {
    this.model = o.model ?? "jev-latest";
  }

  async decide(requests: JevRequest[], context?: { facts: Record<string, unknown> }): Promise<JevResult> {
    // Jev selects; it never writes free text. Only fields with a bounded pool are sent.
    const sendable = requests
      .map((r) => ({ r, pool: r.options.length ? r.options : r.candidates }))
      .filter(({ pool }) => pool.length > 0 && pool.length <= MAX_OPTIONS);
    if (!sendable.length) return { responses: [] };

    const questions = Object.fromEntries(
      sendable.map(({ r, pool }, i) => [
        qid(i),
        {
          type: "choice",
          instructions: `A job application form asks: "${r.label.slice(0, 300)}". Which option should the candidate select, based only on the candidate facts in the state? Choose "${NONE}" if the facts do not determine the answer.`,
          criteria: { ...Object.fromEntries(pool.map((opt, j) => [String(j), opt.slice(0, 200)])), [NONE]: "The candidate facts do not determine the answer." },
        },
      ]),
    );
    // Untrusted page text is only in question instructions/options; the state holds candidate facts.
    const body = { model: this.model, state: JSON.stringify({ candidate: context?.facts ?? {} }), questions };

    const res = await this.post(body);
    const parsed = responseSchema.safeParse(res);
    if (!parsed.success) throw new Error("Jev returned an unexpected response shape.");

    const responses = sendable.map(({ r, pool }, i) => {
      const a = answerSchema.safeParse(parsed.data.answers[qid(i)]);
      if (!a.success || a.data.choice === NONE) return { fieldId: r.fieldId, choice: -1, confidence: 0 };
      const idx = Number(a.data.choice);
      return Number.isInteger(idx) && idx >= 0 && idx < pool.length ? { fieldId: r.fieldId, choice: idx, confidence: a.data.confidence } : { fieldId: r.fieldId, choice: -1, confidence: 0 };
    });
    const u = parsed.data.usage;
    return { responses, usage: u ? { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 } : undefined };
  }

  private async post(body: unknown): Promise<unknown> {
    const f = this.o.fetch ?? fetch;
    const url = `${this.o.baseUrl ?? "https://api.typesafe.ai"}/v1/systemone`;
    const retries = this.o.retries ?? 1;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await f(url, {
          method: "POST",
          headers: { authorization: `Bearer ${this.o.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.o.timeoutMs ?? 10_000),
        });
      } catch (e) {
        if (attempt < retries) continue;
        throw new Error(`Jev request failed: ${e instanceof Error ? e.name : "error"}`);
      }
      if (res.ok) return res.json();
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await new Promise((r) => setTimeout(r, Math.min(2000, 250 * 2 ** attempt)));
        continue;
      }
      throw new Error(`Jev request failed with HTTP ${res.status}.`);
    }
  }
}
