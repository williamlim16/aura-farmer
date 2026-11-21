import { describe, expect, it } from "vitest";

import { rankOptions } from "~/lib/apply/option-rank";
import { suggestOptions } from "~/lib/apply/suggest-options";
import { ScriptedLlm } from "~/lib/apply/decision/llm";
import { addAiSuggestions } from "~/server/apply-real/run-real";
import type { AutofillReport } from "~/server/apply/run";

const DEGREE = ["Associate's Degree", "Bachelor's Degree", "Doctor of Philosophy (Ph.D.)", "Master of Business Administration (M.B.A.)", "Master's Degree", "Other"];
const AUTH = ["Yes, I am an Australian citizen or permanent resident", "Yes, I hold a valid visa with full work rights", "No, I will require visa sponsorship"];

describe("rankOptions", () => {
  it("exact, case/punctuation-insensitive", () => {
    expect(rankOptions(DEGREE, "bachelors degree")).toMatchObject({ kind: "exact", index: 1 });
    expect(rankOptions(["Male", "Female"], "female")).toMatchObject({ kind: "exact", index: 1 });
  });
  it("close: canonical equivalents and unique leading words", () => {
    expect(rankOptions(["Female", "Male", "Non-Binary", "Prefer not to say"], "Man")).toMatchObject({ kind: "close", index: 1 });
    expect(rankOptions(["Female", "Male", "Non-Binary", "Prefer not to say"], "woman")).toMatchObject({ kind: "close", index: 0 });
    expect(rankOptions(["Female", "Male", "Non-Binary", "Prefer not to say"], "nonbinary")).toMatchObject({ kind: "close", index: 2 });
    expect(rankOptions(["Female", "Male", "Non-Binary", "Prefer not to say"], "non binary")).toMatchObject({ kind: "exact", index: 2 });
    expect(rankOptions(["Female", "Male", "Non-Binary", "Prefer not to say"], "Decline to answer")).toMatchObject({ kind: "close", index: 3 });
    expect(rankOptions(["She/Her/Hers", "He/Him/His", "They/Them/Theirs"], "He/Him")).toMatchObject({ kind: "close", index: 1 });
    expect(rankOptions(["She/Her/Hers", "He/Him/His", "They/Them/Theirs"], "they")).toMatchObject({ kind: "close", index: 2 });
    expect(rankOptions(DEGREE, "Bachelor")).toMatchObject({ kind: "close", index: 1 });
  });
  it("never confuses Male with Female or She with He", () => {
    expect(rankOptions(["Female"], "male").kind).not.toBe("close");
    expect(rankOptions(["She/Her/Hers"], "he").kind).not.toBe("close");
  });
  it("suggest: one option shares the most meaningful words", () => {
    expect(rankOptions(DEGREE, "Bachelor of Computer Science")).toMatchObject({ kind: "suggest", index: 1 });
  });
  it("ambiguous: several equally good options, or a bare Yes", () => {
    expect(rankOptions(AUTH, "Yes")).toMatchObject({ kind: "ambiguous", candidates: [0, 1] });
    expect(rankOptions(DEGREE, "Master of Science").kind).toBe("ambiguous");
  });
  it("none when nothing relates; never invents an option", () => {
    expect(rankOptions(["Brisbane", "Sydney"], "Perth")).toEqual({ kind: "none", candidates: [] });
    expect(rankOptions([], "anything")).toEqual({ kind: "none", candidates: [] });
    expect(rankOptions(DEGREE, "   ").kind).toBe("none");
  });
});

describe("LLM option suggestions", () => {
  const items = [{ id: "a", question: "Degree", answer: "Bachelor of Computer Science", options: DEGREE }];
  it("accepts only an exact option from the list", async () => {
    const good = new ScriptedLlm((f) => f.map((x) => ({ id: x.id, value: "Bachelor's Degree", confidence: 0.9 })));
    expect((await suggestOptions(good, items)).get("a")?.option).toBe("Bachelor's Degree");
    const invented = new ScriptedLlm((f) => f.map((x) => ({ id: x.id, value: "Bachelor of Science (Hons)", confidence: 0.99 })));
    expect((await suggestOptions(invented, items)).size).toBe(0);
    const low = new ScriptedLlm((f) => f.map((x) => ({ id: x.id, value: "Bachelor's Degree", confidence: 0.2 })));
    expect((await suggestOptions(low, items)).size).toBe(0);
  });
  it("tells the model the page text is data, and keeps EEO/consent questions away from it", async () => {
    const llm = new ScriptedLlm((f) => f.map((x) => ({ id: x.id, value: x.options?.[0] ?? "", confidence: 0.9 })));
    const mk = (id: string, kind: string, label: string, options: string[]) => ({ id, label, kind, control: "combobox", required: true, tier: "rule", outcome: "needs_human", step: 1, answer: "x", options });
    const report = { fields: [mk("deg", "unknown", "Degree", DEGREE), mk("g", "eeo", "Gender", ["Female", "Male"]), mk("c", "consent", "Agree", ["Yes", "No"])] } as unknown as AutofillReport;
    const events: string[] = [];
    await addAiSuggestions(report, events, llm);
    expect(llm.requests).toHaveLength(1);
    const sent = llm.requests[0]!;
    expect(sent.system).toMatch(/untrusted data/);
    expect(sent.user).toContain("Degree");
    expect(sent.user).not.toContain("Gender");
    expect(sent.user).not.toContain("Agree");
    expect(report.fields[0]).toMatchObject({ suggestions: [DEGREE[0]], suggestedBy: "ai" });
    expect(report.fields[1]).not.toHaveProperty("suggestedBy");
  });
  it("says clearly when no LLM is configured", async () => {
    const events: string[] = [];
    const report = { fields: [{ id: "d", label: "Degree", kind: "unknown", control: "combobox", required: true, tier: "rule", outcome: "needs_human", step: 1, answer: "x", options: DEGREE }] } as unknown as AutofillReport;
    await addAiSuggestions(report, events, null);
    expect(events.join(" ")).toMatch(/AI option suggestions are off \(no LLM configured\)/);
  });
});
