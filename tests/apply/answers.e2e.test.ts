/**
 * The person's own answers are matched to a form's REAL options: exact picks
 * fill (also EEO), near-matches are suggestions the person confirms, async
 * (type-ahead) lists are searched live, and nothing is silently dropped.
 */
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { autofillFixture, launch, startFixtureServer, syntheticProfile, type FixtureServer } from "../helpers/apply-harness";

let browser: Browser;
let server: FixtureServer;
beforeAll(async () => {
  [browser, server] = await Promise.all([launch(), startFixtureServer()]);
});
afterAll(async () => {
  await browser?.close();
  await server?.close();
});

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
function profileWith(answers: Record<string, string>) {
  const p = syntheticProfile();
  p.preferences = { ...(p.preferences ?? {}), savedAnswers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [norm(k), v])) };
  return p;
}
const find = <F extends { label: string }>(fields: F[], re: RegExp) => {
  const f = fields.find((x) => re.test(x.label));
  if (!f) throw new Error(`no field ${re}`);
  return f;
};
const run = async (answers: Record<string, string>) => {
  const { report, context } = await autofillFixture(browser, server, "answers-lookup.html", { profile: profileWith(answers), resumePath: null });
  await context.close();
  return report;
};

describe("answers matched to real options", () => {
  it("before: without answers these questions are open, and the async school list exposes only its first page", async () => {
    const r = await run({});
    expect(find(r.fields, /^School/)).toMatchObject({ outcome: "needs_human", optionsPartial: true });
    expect(find(r.fields, /^School/).options).toHaveLength(100);
    expect(find(r.fields, /^Degree/).options).toContain("Bachelor's Degree");
    expect(find(r.fields, /^What gender/)).toMatchObject({ outcome: "needs_human", reason: expect.stringContaining("EEO") });
  });

  it("searches the async list live for a school outside the preloaded page", async () => {
    const r = await run({ School: "University of Melbourne" });
    expect(find(r.fields, /^School/)).toMatchObject({ outcome: "verified", value: "University of Melbourne" });
  });

  it("reports the live results when a school search is ambiguous, instead of guessing", async () => {
    const r = await run({ School: "University of Sydney" }); // matches two results, one exact -> exact wins
    expect(find(r.fields, /^School/).outcome).toBe("verified");
    const r2 = await run({ School: "Sydney" });
    const f = find(r2.fields, /^School/);
    expect(f.outcome).toBe("error");
    expect(f.reason).toContain("did not match one option");
    expect(f.options).toEqual(expect.arrayContaining(["University of Sydney", "UNSW Sydney"]));
  });

  it("fills an exact selection, including EEO (the person's own choice)", async () => {
    const r = await run({ "What gender do you identify with?": "Male", "Are you located in any of these locations?": "Sydney" });
    expect(find(r.fields, /^What gender/)).toMatchObject({ outcome: "verified", value: "Male" });
    expect(find(r.fields, /^Are you located/)).toMatchObject({ outcome: "verified", value: "Sydney" });
  });

  it("turns a near-match on a sensitive question into a suggestion to confirm, never a silent fill", async () => {
    const r = await run({ "What gender do you identify with?": "Man", "What are your pronouns?": "He/Him" });
    expect(find(r.fields, /^What gender/)).toMatchObject({ outcome: "needs_human", answer: "Man", suggestions: ["Male"] });
    expect(find(r.fields, /^What are your pronouns/)).toMatchObject({ outcome: "needs_human", suggestions: ["He/Him/His"] });
  });

  it("reports ambiguous and unmatched answers with real candidates (nothing dropped)", async () => {
    const r = await run({ "Are you legally authorised to work in Australia without restrictions?": "Yes", Degree: "Bachelor of Computer Science", "Are you located in any of these locations?": "Perth" });
    const auth = find(r.fields, /^Are you legally/);
    expect(auth).toMatchObject({ outcome: "needs_human", answer: "Yes" });
    expect(auth.suggestions).toHaveLength(3);
    expect(find(r.fields, /^Degree/)).toMatchObject({ outcome: "needs_human", suggestions: ["Bachelor's Degree"] });
    const loc = find(r.fields, /^Are you located/);
    expect(loc).toMatchObject({ outcome: "needs_human", answer: "Perth" });
    expect(loc.reason).toContain("No option matches");
  });

  it("applies a chosen option exactly and verifies it in the form", async () => {
    const r = await run({ Degree: "Bachelor's Degree", "Are you legally authorised to work in Australia without restrictions?": "Yes, I hold a valid visa with full work rights" });
    expect(find(r.fields, /^Degree/)).toMatchObject({ outcome: "verified", value: "Bachelor's Degree" });
    expect(find(r.fields, /^Are you legally/)).toMatchObject({ outcome: "verified", value: "Yes, I hold a valid visa with full work rights" });
  });
});
