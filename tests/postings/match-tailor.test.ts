/** Matching never invents facts; tailoring only reorders/uses stated facts; PDF contains only profile facts. */
import { describe, expect, it } from "vitest";

import { matchProfileToPosting } from "~/lib/match/match";
import { applyTailoring, suggestTailoring, verifyNoNewFacts } from "~/lib/tailor/tailor";
import { renderResumePdf } from "~/server/resume/pdf";
import { extractResumeText } from "~/server/resume/extract-text";
import { syntheticProfile } from "../helpers/apply-harness";

const REQS = {
  required: ["5+ years of experience with TypeScript", "Experience with React and Node.js", "Experience with Kubernetes and Terraform", "Authorized to work in Australia", "Must be located in Melbourne", "Bachelor's degree in Computer Science or equivalent", "Strong communication with stakeholders"],
  preferred: ["Experience with Go", "Visa sponsorship is not available"],
};

describe("matchProfileToPosting", () => {
  it("separates stated evidence, partial, inference and gaps, with quotes", () => {
    const m = matchProfileToPosting(syntheticProfile(), REQS);
    const by = (t: string) => m.requirements.find((r) => r.text.startsWith(t))!;
    expect(by("5+ years")).toMatchObject({ status: "inferred", note: expect.stringContaining("not years per skill") });
    expect(by("Experience with React")).toMatchObject({ status: "supported" });
    expect(by("Experience with React").evidence.join(" ")).toMatch(/React/);
    expect(by("Experience with Kubernetes")).toMatchObject({ status: "unverified", note: expect.stringContaining("Kubernetes, Terraform") });
    expect(by("Authorized to work")).toMatchObject({ status: "supported", evidence: ["Profile: authorised to work in Australia"] });
    expect(by("Must be located")).toMatchObject({ status: "supported" });
    expect(by("Bachelor's")).toMatchObject({ status: "supported" });
    expect(by("Experience with Go")).toMatchObject({ status: "unverified" });
    expect(m.matchedSkills).toEqual(expect.arrayContaining(["TypeScript", "React", "Node.js"]));
    expect(m.missingSkills).toEqual(expect.arrayContaining(["Kubernetes", "Terraform", "Go"]));
    expect(m.score).toBeGreaterThan(2);
    expect(m.score).toBeLessThan(5);
  });

  it("never assumes work rights or sponsorship; contradictions become blockers", () => {
    const p = syntheticProfile();
    delete p.preferences.workAuthorization;
    delete p.preferences.needsSponsorship;
    const unknown = matchProfileToPosting(p, REQS);
    expect(unknown.requirements.find((r) => r.text.startsWith("Authorized"))!.status).toBe("unverified");
    expect(unknown.blockers.map((b) => [b.kind, b.severity])).toEqual(expect.arrayContaining([["work_authorization", "check"], ["sponsorship", "check"]]));

    p.preferences.workAuthorization = { Australia: false };
    p.preferences.needsSponsorship = true;
    const contra = matchProfileToPosting(p, REQS);
    expect(contra.blockers.filter((b) => b.severity === "blocker").map((b) => b.kind).sort()).toEqual(["sponsorship", "work_authorization"]);
    expect(contra.score).toBeLessThanOrEqual(2.5);
  });

  it("reports a years gap from stated totals", () => {
    const m = matchProfileToPosting(syntheticProfile(), { required: ["10+ years of professional experience"], preferred: [] });
    expect(m.requirements[0]).toMatchObject({ status: "gap" });
    expect(m.blockers[0]).toMatchObject({ kind: "years", severity: "check" });
  });
});

describe("tailoring", () => {
  const posting = { title: "Senior Frontend Engineer", company: "Example Corp", description: "" };
  it("suggests reorderings and a fact-only summary; applies only accepted ones", () => {
    const p = syntheticProfile();
    const m = matchProfileToPosting(p, REQS);
    const t = suggestTailoring(p, posting, m);
    expect(t.suggestions.map((s) => s.kind)).toEqual(expect.arrayContaining(["skills_order", "summary"]));
    expect(t.answers.find((a) => a.id === "why_company")).toMatchObject({ source: "template", answer: expect.stringContaining("[Edit this draft") });
    // Nothing accepted -> unchanged except no saved answers.
    expect(applyTailoring(p, t).skills).toEqual(p.skills);
    for (const s of t.suggestions) s.status = "accepted";
    t.answers[0]!.status = "accepted";
    const out = applyTailoring(p, t);
    expect(out.skills[0]).toBe("TypeScript");
    expect(new Set(out.skills)).toEqual(new Set(p.skills));
    expect(out.summary).toMatch(/^Senior Software Engineer with 6 years of experience/);
    expect(out.preferences.savedAnswers?.["@why_company"]).toContain("Example Corp");
  });

  it("verification rejects any invented fact", () => {
    const p = syntheticProfile();
    const bad = structuredClone(p);
    bad.skills.push("Kubernetes");
    expect(() => verifyNoNewFacts(p, bad)).toThrow(/skills/);
    const bad2 = structuredClone(p);
    bad2.summary = "Senior Software Engineer with 6 years of experience, working with Kubernetes.";
    expect(() => verifyNoNewFacts(p, bad2)).toThrow(/Kubernetes/);
    const bad3 = structuredClone(p);
    bad3.experience[0]!.bullets.push("Led a team of 50");
    expect(() => verifyNoNewFacts(p, bad3)).toThrow(/bullets/);
  });

  it("renders a tailored PDF containing only profile facts", async () => {
    const p = syntheticProfile();
    const t = suggestTailoring(p, posting, matchProfileToPosting(p, REQS));
    t.suggestions.forEach((s) => (s.status = "accepted"));
    const text = await extractResumeText(await renderResumePdf(applyTailoring(p, t)), "pdf");
    expect(text).toContain("Avery Quinn");
    expect(text).toContain("Northwind Labs");
    expect(text).not.toMatch(/Kubernetes|Terraform/);
  });
});

describe("inference quality (regression from a live posting)", () => {
  it("does not infer support from filler-word overlaps", async () => {
    const { extractResumeText: ext } = await import("~/server/resume/extract-text");
    const { parseResumeText } = await import("~/lib/resume/parse-profile");
    const { makeRealisticResumePdf } = await import("../helpers/realistic-resume");
    const p = parseResumeText(await ext(await makeRealisticResumePdf(), "pdf")).profile;
    const m = matchProfileToPosting(p, { required: [
      "Take full ownership of ambiguous, open-ended problems and drive them to completion with minimal direction",
      "Are a power user of agentic coding tools with deep intuition about model capabilities and limitations",
      "Care deeply about correctness and reliability, and have raised engineering standards on teams you've been part of",
      "Have a history of setting technical direction that others follow through design docs and design reviews",
    ], preferred: [] });
    const st = m.requirements.map((r) => r.status);
    expect(st.slice(0, 3)).toEqual(["unverified", "unverified", "unverified"]);
    expect(m.requirements[3]).toMatchObject({ status: "inferred", evidence: [expect.stringContaining("design reviews")] });
  });
});
