import { describe, expect, it } from "vitest";

import { candidateProfileSchema } from "~/lib/profile/schema";
import { parseResumeText } from "~/lib/resume/parse-profile";
import { extractResumeText, ResumeTextError } from "~/server/resume/extract-text";
import { makeDocx, makePdf, SAMPLE_RESUME_LINES } from "../helpers/resume-fixtures";

const NOW = new Date("2026-11-21");

function checkSample(text: string) {
  const { profile, missing } = parseResumeText(text, NOW);
  expect(candidateProfileSchema.safeParse(profile).success).toBe(true);
  const c = profile.contact;
  expect(c.fullName?.value).toBe("Avery Quinn");
  expect(c.firstName?.value).toBe("Avery");
  expect(c.lastName?.value).toBe("Quinn");
  expect(c.email?.value).toBe("avery.quinn@example.com");
  expect(c.phone?.value.replace(/\D/g, "")).toBe("61400555123");
  expect(c.location?.value).toBe("Melbourne, VIC, Australia");
  expect(c.linkedin?.value).toBe("https://linkedin.com/in/avery-quinn-demo");
  expect(c.github?.value).toBe("https://github.com/averyq-demo");
  expect(c.website?.value).toBe("https://averyquinn.example.com");
  expect(profile.experience).toHaveLength(2);
  expect(profile.experience[0]).toMatchObject({
    title: "Senior Software Engineer",
    company: "Northwind Labs",
    start: "Mar 2021",
    end: "Present",
  });
  expect(profile.experience[0]!.bullets).toHaveLength(2);
  expect(profile.education[0]).toMatchObject({
    degree: "Bachelor of Computer Science",
    institution: "University of Melbourne",
    start: "2015",
    end: "2018",
  });
  expect(profile.skills).toEqual(expect.arrayContaining(["TypeScript", "Playwright", "PostgreSQL"]));
  expect(profile.totalYearsExperience?.value).toBe(6);
  expect(missing).toEqual([]);
}

describe("parseResumeText", () => {
  it("parses the synthetic sample from plain text", () => {
    checkSample(SAMPLE_RESUME_LINES.join("\n"));
  });

  it("reports missing fields instead of guessing", () => {
    const { profile, missing } = parseResumeText("Jordan Lee\nSKILLS\nGo, Rust\n");
    expect(profile.contact.email).toBeUndefined();
    expect(missing).toEqual(expect.arrayContaining(["contact.email", "contact.phone", "experience", "education"]));
    expect(profile.skills).toEqual(["Go", "Rust"]);
  });

  it("supports 'Title at Company | dates' on one line and computes years", () => {
    const text = ["Sam Rivera", "sam@example.com", "Experience", "Data Engineer at Fabrikam | Jan 2020 - Present", "• Built pipelines"].join("\n");
    const { profile } = parseResumeText(text, NOW);
    expect(profile.experience[0]).toMatchObject({ title: "Data Engineer", company: "Fabrikam", start: "Jan 2020" });
    expect(profile.totalYearsExperience).toMatchObject({ value: 6, confidence: 0.5 });
  });

  it("does not treat a skills line as a name", () => {
    const { profile } = parseResumeText("React, Node, AWS\nsam@example.com");
    expect(profile.contact.fullName).toBeUndefined();
  });
});

describe("extractResumeText (real files, no network)", () => {
  it("extracts and parses a generated PDF", async () => {
    const text = await extractResumeText(await makePdf(), "pdf");
    checkSample(text);
  });

  it("extracts and parses a generated DOCX", async () => {
    const text = await extractResumeText(await makeDocx(), "docx");
    checkSample(text);
  });

  it("rejects an image-only / empty PDF with a clear error", async () => {
    await expect(extractResumeText(await makePdf([""]), "pdf")).rejects.toMatchObject({ code: "no_text" });
  });

  it("rejects corrupt input", async () => {
    const bad = new TextEncoder().encode("%PDF-1.7 garbage");
    await expect(extractResumeText(bad, "pdf")).rejects.toBeInstanceOf(ResumeTextError);
  });
});
