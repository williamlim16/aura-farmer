/**
 * Fictional candidates for the Apply Demo. Not real people; example.com
 * emails and reserved phone ranges. The demo accepts no other candidate data.
 */
import { candidateProfileSchema, type CandidateProfile } from "~/lib/profile/schema";

const u = <T>(value: T) => ({ value, source: "user" as const, confidence: 1 });

export const DEMO_PERSONAS = {
  "alex-rivera": {
    label: "Alex Rivera — Senior Software Engineer, Sydney (fictional)",
    profile: {
      schemaVersion: 1,
      contact: {
        fullName: u("Alex Rivera"), firstName: u("Alex"), lastName: u("Rivera"),
        email: u("alex.rivera@example.com"), phone: u("+61 491 570 006"), location: u("Sydney, NSW, Australia"),
        linkedin: u("https://www.linkedin.com/in/alex-rivera-example"), github: u("https://github.com/alex-rivera-example"),
      },
      summary: "Software engineer with 7 years building web platforms in TypeScript and Node.js. Leads testing and reliability work.",
      experience: [
        { title: "Senior Software Engineer", company: "Example Systems", start: "2021", end: "Present", bullets: ["Led migration of billing services to PostgreSQL, cutting p95 latency by 40%.", "Built a Playwright end-to-end test suite covering 300 user journeys."] },
        { title: "Software Engineer", company: "Sample Labs", start: "2018", end: "2021", bullets: ["Shipped React dashboards used by 2,000 internal users."] },
      ],
      education: [{ degree: "Bachelor of Computer Science", institution: "Example University", start: "2014", end: "2017" }],
      skills: ["TypeScript", "React", "Node.js", "PostgreSQL", "Playwright", "AWS"],
      preferences: { workAuthorization: { Australia: true }, needsSponsorship: false, salaryExpectation: "AUD 160,000", noticePeriod: "4 weeks", referralSource: "Company website" },
    },
  },
  "sam-chen": {
    label: "Sam Chen — Data Engineer, Melbourne, needs sponsorship (fictional)",
    profile: {
      schemaVersion: 1,
      contact: {
        fullName: u("Sam Chen"), firstName: u("Sam"), lastName: u("Chen"),
        email: u("sam.chen@example.com"), phone: u("+61 491 570 110"), location: u("Melbourne, VIC, Australia"),
        linkedin: u("https://www.linkedin.com/in/sam-chen-example"),
      },
      summary: "Data engineer with 4 years of experience building batch and streaming pipelines in Python and SQL.",
      experience: [{ title: "Data Engineer", company: "Placeholder Analytics", start: "2022", end: "Present", bullets: ["Built Airflow pipelines processing 50M events per day."] }],
      education: [{ degree: "Master of Data Science", institution: "Sample Institute of Technology", start: "2020", end: "2021" }],
      skills: ["Python", "SQL", "Airflow", "Spark", "dbt"],
      preferences: { workAuthorization: { Australia: false }, needsSponsorship: true, noticePeriod: "2 weeks", referralSource: "LinkedIn" },
    },
  },
} as const;

export type DemoPersonaKey = keyof typeof DEMO_PERSONAS;

export function demoPersona(key: unknown): { key: DemoPersonaKey; label: string; profile: CandidateProfile } | null {
  if (typeof key !== "string" || !Object.hasOwn(DEMO_PERSONAS, key)) return null;
  const p = DEMO_PERSONAS[key as DemoPersonaKey];
  return { key: key as DemoPersonaKey, label: p.label, profile: candidateProfileSchema.parse(structuredClone(p.profile)) };
}
