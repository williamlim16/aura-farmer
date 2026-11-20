import { describe, expect, it } from "vitest";

import { APPLICATION_STATUSES } from "~/lib/applications/status";
import { displayValue, fieldGroup, groupFields, statusView, type ReportFieldLike } from "~/lib/applications/view";

const f = (p: Partial<ReportFieldLike>): ReportFieldLike => ({ id: "x", label: "L", kind: "unknown", required: false, tier: "rule", outcome: "verified", round: 1, ...p });

describe("application view model", () => {
  it("groups fields into review buckets", () => {
    expect(fieldGroup(f({}))).toBe("filled");
    expect(fieldGroup(f({ tier: "llm", reviewRequired: true }))).toBe("review");
    expect(fieldGroup(f({ outcome: "needs_human" }))).toBe("review");
    expect(fieldGroup(f({ outcome: "needs_human", tier: "guard" }))).toBe("blocked");
    expect(fieldGroup(f({ outcome: "mismatch" }))).toBe("problem");
    expect(fieldGroup(f({ outcome: "error" }))).toBe("problem");
    expect(fieldGroup(f({ outcome: "skipped" }))).toBe("skipped");
    const g = groupFields([f({}), f({ outcome: "error" })]);
    expect(g.filled).toHaveLength(1);
    expect(g.problem).toHaveLength(1);
  });

  it("formats values and reasons", () => {
    expect(displayValue(f({ value: true }))).toBe("Checked");
    expect(displayValue(f({ kind: "resume" }))).toBe("Resume attached");
    expect(displayValue(f({ outcome: "needs_human", reason: "Not stated." }))).toBe("Not stated.");
  });

  it("only the user-confirmed status reaches the Submitted stage", () => {
    for (const s of APPLICATION_STATUSES) {
      const v = statusView(s);
      expect(v.stageIndex === 3).toBe(s === "submitted_by_user");
    }
    expect(statusView("ready_for_review").label).not.toMatch(/submitted/i);
  });
});
