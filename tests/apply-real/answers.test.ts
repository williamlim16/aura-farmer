import { describe, expect, it } from "vitest";

import { answerableFields, answerControl, confidenceLabel, normQ, savedAnswersFrom, statusOf, type ReportField } from "~/components/apply-real/answers";
import { normQ as engineNormQ } from "~/lib/apply/decision/rules";
import { parsePostingUrl } from "~/server/postings/url";

const f = (o: Partial<ReportField>): ReportField => ({ id: "x", label: "Q", control: "text", kind: "unknown", required: false, tier: "rule", outcome: "needs_human", step: 1, ...o });

describe("review UI helpers", () => {
  it("keys answers exactly like the engine does", () => {
    for (const q of ["Are you legally authorised to work in Australia without restrictions?", "What are your pronouns?", "If required, are you open to relocation for this role?"]) expect(normQ(q)).toBe(engineNormQ(q));
    expect(savedAnswersFrom({ "What are your pronouns?": " He/Him/His ", Empty: "  " })).toEqual({ "what are your pronouns": "He/Him/His" });
  });
  it("never offers file uploads as text answers, and keeps answered questions visible", () => {
    const fields = [f({ label: "Cover Letter", control: "file" }), f({ label: "Resume/CV", control: "file" }), f({ label: "School", control: "combobox", options: ["A"], optionsPartial: true }), f({ label: "Degree", control: "combobox", options: ["A", "B"], outcome: "verified" }), f({ label: "Gender", control: "combobox", options: ["F", "M"] })];
    expect(answerableFields(fields, {}).map((x) => x.label)).toEqual(["School", "Gender"]);
    expect(answerableFields(fields, { Degree: "B" }).map((x) => x.label)).toEqual(["School", "Degree", "Gender"]);
  });
  it("chooses a control from the real options", () => {
    expect(answerControl(f({ control: "combobox", options: ["A", "B"] }))).toBe("select");
    expect(answerControl(f({ control: "combobox", options: ["A"], optionsPartial: true }))).toBe("search");
    expect(answerControl(f({ control: "combobox", options: [] }))).toBe("search");
    expect(answerControl(f({ control: "radio", options: ["Yes", "No"] }))).toBe("select");
    expect(answerControl(f({ control: "checkbox" }))).toBe("checkbox");
    expect(answerControl(f({ control: "textarea" }))).toBe("textarea");
  });
  it("describes status and confidence", () => {
    expect(statusOf(f({ outcome: "verified" })).tone).toBe("ok");
    expect(statusOf(f({ suggestions: ["M"] })).label).toBe("Confirm a suggestion");
    expect(statusOf(f({ outcome: "error" })).tone).toBe("bad");
    expect(confidenceLabel(f({ outcome: "verified", confidence: 1, note: "Your selection", answer: "Man" }))).toBe("from your answer");
  });
});

describe("regional Greenhouse links", () => {
  it("accepts global and regional job-board hosts, not look-alikes", () => {
    expect(parsePostingUrl("https://job-boards.anz.greenhouse.io/quantium/jobs/4005587201")).toMatchObject({ ok: true, source: "greenhouse", canonical: "https://job-boards.anz.greenhouse.io/quantium/jobs/4005587201" });
    expect(parsePostingUrl("https://job-boards.eu.greenhouse.io/acme/jobs/1")).toMatchObject({ ok: true });
    expect(parsePostingUrl("https://job-boards.greenhouse.io.evil.com/acme/jobs/1").ok).toBe(false);
    expect(parsePostingUrl("https://evilgreenhouse.io/acme/jobs/1").ok).toBe(false);
  });
});
