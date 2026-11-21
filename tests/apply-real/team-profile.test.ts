import { describe, expect, it } from "vitest";

import { splitSkills, teamProfileToCandidate } from "~/server/apply-real/team-profile";

const profile = {
  fullName: "Ada Lovelace Byron",
  location: "Melbourne, Australia",
  phone: "+61 400 000 000",
  websiteUrl: "ada.dev",
  linkedinUrl: "https://www.linkedin.com/in/ada",
  githubUrl: "javascript:alert(1)",
  summary: "Engineer.",
  skills: "Languages: TypeScript, Go\nTools: Docker; Postgres • typescript",
};

describe("teamProfileToCandidate", () => {
  const p = teamProfileToCandidate({
    profile,
    experiences: [{ jobTitle: "Engineer", company: "Acme", startDate: "Jan 2022", endDate: null, isCurrent: true, description: "• Built APIs\n- Cut costs 20%\n\n" }],
    educations: [{ school: "University of Melbourne", degree: "BSc", fieldOfStudy: "Computer Science", startDate: "2018", endDate: "2021" }],
    email: "ada@example.com",
  });

  it("maps contact details as user-sourced values and splits the name", () => {
    expect(p.contact.firstName?.value).toBe("Ada");
    expect(p.contact.lastName?.value).toBe("Lovelace Byron");
    expect(p.contact.email).toMatchObject({ value: "ada@example.com", source: "user", confidence: 1 });
    expect(p.contact.website?.value).toBe("https://ada.dev/");
  });
  it("drops non-http(s) URLs instead of passing them to a form", () => {
    expect(p.contact.github).toBeUndefined();
  });
  it("maps experience and education", () => {
    expect(p.experience[0]).toMatchObject({ title: "Engineer", company: "Acme", start: "Jan 2022", end: "Present", bullets: ["Built APIs", "Cut costs 20%"] });
    expect(p.education[0]).toMatchObject({ institution: "University of Melbourne", degree: "BSc, Computer Science" });
  });
  it("never invents application preferences (work rights, sponsorship, EEO)", () => {
    expect(p.preferences).toEqual({});
  });
  it("omits an invalid email rather than guessing", () => {
    expect(teamProfileToCandidate({ profile: null, experiences: [], educations: [], email: "nope" }).contact.email).toBeUndefined();
  });
});

describe("splitSkills", () => {
  it("flattens categories, de-duplicates case-insensitively and bounds length", () => {
    expect(splitSkills(profile.skills)).toEqual(["TypeScript", "Go", "Docker", "Postgres"]);
    expect(splitSkills(null)).toEqual([]);
    expect(splitSkills("x".repeat(200))).toEqual([]);
  });
});
