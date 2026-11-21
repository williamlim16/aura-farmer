/** Regression: realistic resume layouts (right-aligned dates, company on the next line, wrapped bullets, location in the contact line). */
import { describe, expect, it } from "vitest";

import { parseResumeText, type ParseResult } from "~/lib/resume/parse-profile";
import { extractResumeText } from "~/server/resume/extract-text";
import { makeRealisticResumePdf, MORGAN } from "../helpers/realistic-resume";

/** Field-level accuracy against the known truth (also used in the end-to-end report). */
export function scoreExtraction(r: ParseResult) {
  const p = r.profile;
  const checks: [string, boolean][] = [
    ["name", p.contact.fullName?.value === MORGAN.fullName],
    ["email", p.contact.email?.value === MORGAN.email],
    ["phone", p.contact.phone?.value.replace(/\D/g, "") === MORGAN.phone.replace(/\D/g, "")],
    ["location", p.contact.location?.value === MORGAN.location],
    ["linkedin", p.contact.linkedin?.value === MORGAN.linkedin],
    ["github", p.contact.github?.value === MORGAN.github],
    ["summary", p.summary === MORGAN.summary],
    ...MORGAN.experience.flatMap((e, i): [string, boolean][] => [
      [`exp${i + 1}.title`, p.experience[i]?.title === e.title],
      [`exp${i + 1}.company`, p.experience[i]?.company === e.company],
      [`exp${i + 1}.dates`, p.experience[i]?.start === e.start && p.experience[i]?.end === e.end],
      [`exp${i + 1}.bullets`, JSON.stringify(p.experience[i]?.bullets) === JSON.stringify(e.bullets)],
    ]),
    ["edu.degree", p.education[0]?.degree === MORGAN.education[0]!.degree],
    ["edu.institution", p.education[0]?.institution === MORGAN.education[0]!.institution],
    ["edu.dates", p.education[0]?.start === "2014" && p.education[0]?.end === "2017"],
    ["skills", JSON.stringify(p.skills) === JSON.stringify([...MORGAN.technicalSkills, ...MORGAN.softSkills])],
    ["no invented roles", p.experience.length === MORGAN.experience.length],
  ];
  return { correct: checks.filter(([, ok]) => ok).length, total: checks.length, failed: checks.filter(([, ok]) => !ok).map(([k]) => k) };
}

describe("realistic resume layouts", () => {
  it("extracts every field of the realistic PDF (field-level accuracy 100%)", async () => {
    const text = await extractResumeText(await makeRealisticResumePdf(), "pdf");
    const s = scoreExtraction(parseResumeText(text, new Date("2026-11-21")));
    expect(s.failed).toEqual([]);
    expect(s.correct).toBe(s.total);
  });

  it("company line first, title second; date-only line; location on its own line", () => {
    const text = ["Riley Chen", "Brisbane, QLD", "riley@example.com", "Experience", "Northwind Labs   Jan 2020 - Present", "Platform Engineer", "• Built things", "that wrapped", "Fabrikam Pty Ltd", "Software Developer", "2017 - 2019", "• Wrote APIs", "Education", "University of Queensland", "Bachelor of Information Technology", "2013 - 2016"].join("\n");
    const { profile } = parseResumeText(text, new Date("2026-11-21"));
    expect(profile.contact.location?.value).toBe("Brisbane, QLD");
    expect(profile.experience[0]).toMatchObject({ title: "Platform Engineer", company: "Northwind Labs", start: "Jan 2020", end: "Present", bullets: ["Built things that wrapped"] });
    expect(profile.education[0]).toMatchObject({ degree: "Bachelor of Information Technology", institution: "University of Queensland" });
  });

  it("splits a separator-less skills run (e.g. from a table) into known skills, keeps soft skills", () => {
    const { profile } = parseResumeText("Sam Rivera\nsam@example.com\nSkills\nPython Java SQL Docker Kubernetes\nTeamwork, Problem solving");
    expect(profile.skills).toEqual(["Python", "Java", "SQL", "Docker", "Kubernetes", "Teamwork", "Problem solving"]);
  });

  it("never invents roles from bullet text or the summary", () => {
    const { profile } = parseResumeText("Jo Park\njo@example.com\nSummary\nEngineer with 5 years of experience\nExperience\n• Did a thing\n• Did another thing");
    expect(profile.experience).toEqual([]);
  });
});
