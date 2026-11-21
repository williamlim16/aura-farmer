import { describe, expect, it } from "vitest";

import { applyReview, toReview } from "~/lib/profile/review";
import { parseResumeText } from "~/lib/resume/parse-profile";
import { SAMPLE_RESUME_LINES } from "../helpers/resume-fixtures";

const parsed = () => parseResumeText(SAMPLE_RESUME_LINES.join("\n"), new Date("2026-11-21")).profile;

describe("profile review round trip", () => {
  it("toReview exposes values with provenance and empty preferences", () => {
    const r = toReview(parsed());
    expect(r.contact.email).toMatchObject({ value: "avery.quinn@example.com", source: "parsed" });
    expect(r.preferences.needsSponsorship).toBe("");
    expect(r.experience).toHaveLength(2);
  });

  it("marks only edited fields as user-confirmed and keeps the rest", () => {
    const base = parsed();
    const res = applyReview(base, { contact: { email: "avery.q@example.com", phone: base.contact.phone!.value } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.profile.contact.email).toEqual({ value: "avery.q@example.com", source: "user", confidence: 1 });
    expect(res.profile.contact.phone?.source).toBe("parsed");
  });

  it("re-derives first/last name from an edited full name", () => {
    const res = applyReview(parsed(), { contact: { fullName: "Avery J Quinn-Smith" } });
    expect(res.ok && res.profile.contact.firstName?.value).toBe("Avery");
    expect(res.ok && res.profile.contact.lastName?.value).toBe("J Quinn-Smith");
  });

  it("sets preferences from the review form", () => {
    const res = applyReview(parsed(), { preferences: { workAuthCountry: "Australia", workAuthorized: "yes", needsSponsorship: "no", salaryExpectation: "150000" } });
    expect(res.ok && res.profile.preferences).toMatchObject({ workAuthorization: { Australia: true }, needsSponsorship: false, salaryExpectation: "150000" });
  });

  it("returns field errors for invalid input instead of saving", () => {
    const res = applyReview(parsed(), { contact: { email: "not-an-email" }, totalYearsExperience: "abc", preferences: { workAuthorized: "yes", workAuthCountry: "" } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(Object.keys(res.errors)).toEqual(expect.arrayContaining(["email", "totalYearsExperience", "workAuthCountry"]));
  });

  it("normalises URLs and clears removed values", () => {
    const res = applyReview(parsed(), { contact: { github: "github.com/new-demo", website: "" } });
    expect(res.ok && res.profile.contact.github?.value).toBe("https://github.com/new-demo");
    expect(res.ok && res.profile.contact.website).toBeUndefined();
  });
});
