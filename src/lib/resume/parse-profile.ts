/**
 * Deterministic resume text -> CandidateProfile parser.
 *
 * Handles the common single-column layouts (contact header, then headed
 * sections). Anything it cannot find is reported in `missing`, so an LLM
 * extractor can be asked for only those fields instead of the whole resume.
 * Pure function: no I/O, safe to unit test and to run on the client.
 */
import {
  emptyProfile,
  type CandidateProfile,
  type SourcedValue,
} from "~/lib/profile/schema";

type SectionKey = "summary" | "experience" | "education" | "skills" | "projects" | "other";

const SECTION_HEADINGS: [SectionKey, RegExp][] = [
  ["summary", /^(professional\s+)?(summary|profile|about( me)?|objective)$/i],
  ["experience", /^(work\s+|professional\s+|relevant\s+)?(experience|employment( history)?|work history|career history)$/i],
  ["education", /^(education|academic background|qualifications)( (and|&) (training|certifications))?$/i],
  ["skills", /^((technical|core|key)\s+)?(skills|technologies|tech stack|competencies)$/i],
  ["projects", /^(selected\s+|personal\s+)?projects$/i],
  ["other", /^(certifications?|awards|publications|languages|interests|volunteering|references)$/i],
];

function headingKey(line: string): SectionKey | null {
  const t = line.replace(/[:\s]+$/, "").trim();
  if (t.length > 40) return null;
  for (const [key, re] of SECTION_HEADINGS) if (re.test(t)) return key;
  return null;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/;
const URL_RE = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s|,]*)?/gi;
const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const DATE = `(?:${MONTH}\\s+\\d{4}|\\d{1,2}/\\d{4}|\\d{4})`;
const RANGE_RE = new RegExp(`(${DATE})\\s*(?:-|–|—|to)\\s*(${DATE}|present|current|now)`, "i");
const BULLET_RE = /^\s*[-•*▪◦·]\s+/;

const sv = <T>(value: T, confidence: number): SourcedValue<T> => ({ value, source: "parsed", confidence });

function toUrl(raw: string): string {
  const s = raw.replace(/[).,;]+$/, "");
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

function digitsCount(s: string) {
  return (s.match(/\d/g) ?? []).length;
}

function looksLikeName(line: string): boolean {
  if (EMAIL_RE.test(line) || /\d/.test(line) || /[|@/:]/.test(line)) return false;
  const words = line.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((w) => /^[\p{Lu}][\p{L}'’.-]*$/u.test(w));
}

function looksLikeLocation(line: string): boolean {
  if (EMAIL_RE.test(line) || digitsCount(line) > 4 || /https?:|\.com|\|/.test(line)) return false;
  return /^[\p{L} .'-]+,\s*[\p{L} .'-]+(,\s*[\p{L} .'-]+)?$/u.test(line.trim()) && line.length <= 60;
}

function parseMonthYear(s: string): Date | null {
  if (/present|current|now/i.test(s)) return new Date();
  const y = (/\d{4}/.exec(s))?.[0];
  if (!y) return null;
  const m = (new RegExp(MONTH, "i").exec(s))?.[0]?.slice(0, 3).toLowerCase();
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const mi = m ? months.indexOf(m) : s.includes("/") ? Number(s.split("/")[0]) - 1 : 0;
  return new Date(Number(y), Math.max(0, mi), 1);
}

/** Split "Title, Company" / "Title at Company" / "Title | Company" / "Title - Company". */
function splitRoleLine(line: string): { title: string; company: string } | null {
  const cleaned = line.replace(RANGE_RE, "").replace(/[|,–—-]\s*$/, "").trim();
  const m =
    (/^(.+?)\s+(?:at|@)\s+(.+)$/i.exec(cleaned)) ??
    (/^(.+?)\s*[|,–—]\s*(.+)$/.exec(cleaned)) ??
    (/^(.+?)\s+-\s+(.+)$/.exec(cleaned));
  if (!m) return null;
  return { title: m[1]!.trim(), company: m[2]!.trim() };
}

export interface ParseResult {
  profile: CandidateProfile;
  /** Profile paths the parser could not fill; candidates for LLM fallback. */
  missing: string[];
  sections: Partial<Record<SectionKey, string[]>>;
}

export function parseResumeText(text: string, now: Date = new Date()): ParseResult {
  const lines = text.split("\n").map((l) => l.trim());
  const profile = emptyProfile();
  const sections: Partial<Record<SectionKey, string[]>> = {};
  const header: string[] = [];

  let current: SectionKey | null = null;
  for (const line of lines) {
    const key = headingKey(line);
    if (key) {
      current = key;
      sections[key] ??= [];
      continue;
    }
    if (!line) continue;
    if (current) sections[current]!.push(line);
    else header.push(line);
  }

  // --- Contact (search the header first, then the whole text) ---
  const headerText = header.join("\n");
  const email = ((EMAIL_RE.exec(headerText)) ?? (EMAIL_RE.exec(text)))?.[0];
  if (email) profile.contact.email = sv(email, 0.95);

  const phoneMatch = [headerText, text].map((t) => (PHONE_RE.exec(t))?.[0]).find((p) => p && digitsCount(p) >= 8 && digitsCount(p) <= 15);
  if (phoneMatch) profile.contact.phone = sv(phoneMatch.trim(), 0.85);

  // Remove emails first, or "first.last@x.com" yields a bogus "first.last" URL.
  const headerNoEmail = headerText.replace(new RegExp(EMAIL_RE.source, "g"), " ");
  const urls = [...headerNoEmail.matchAll(URL_RE)].map((m) => m[0]);
  for (const u of urls) {
    const url = toUrl(u);
    if (/linkedin\.com\/in\//i.test(url)) profile.contact.linkedin ??= sv(url, 0.95);
    else if (/github\.com\/[^/\s]+/i.test(url)) profile.contact.github ??= sv(url, 0.95);
    else if (/\.[a-z]{2,}(\/|$)/i.test(url) && !/linkedin|github/i.test(url)) profile.contact.website ??= sv(url, 0.7);
  }

  const nameLine = header.find(looksLikeName);
  if (nameLine) {
    const parts = nameLine.trim().split(/\s+/);
    profile.contact.fullName = sv(nameLine.trim(), header[0] === nameLine ? 0.9 : 0.7);
    profile.contact.firstName = sv(parts[0]!, 0.8);
    profile.contact.lastName = sv(parts.slice(1).join(" "), 0.8);
  }

  const locationLine = header.find((l) => l !== nameLine && looksLikeLocation(l));
  if (locationLine) profile.contact.location = sv(locationLine.trim(), 0.7);

  // --- Summary ---
  if (sections.summary?.length) profile.summary = sections.summary.join(" ");

  // --- Experience ---
  const exp = sections.experience ?? [];
  for (let i = 0; i < exp.length; i++) {
    const line = exp[i]!;
    if (BULLET_RE.test(line)) {
      profile.experience.at(-1)?.bullets.push(line.replace(BULLET_RE, ""));
      continue;
    }
    const sameLineRange = RANGE_RE.exec(line);
    const nextRange = exp[i + 1]?.match(RANGE_RE);
    const isRangeOnly = sameLineRange && line.replace(RANGE_RE, "").replace(/[|,\s]/g, "") === "";
    if (isRangeOnly) continue;
    const role = splitRoleLine(line);
    const range = sameLineRange ?? (nextRange && exp[i + 1]!.replace(RANGE_RE, "").replace(/[|,\s]/g, "") === "" ? nextRange : null);
    if (role && range) {
      profile.experience.push({ ...role, start: range[1], end: range[2], bullets: [] });
    } else if (profile.experience.length) {
      profile.experience.at(-1)!.bullets.push(line);
    }
  }

  // --- Education ---
  const edu = sections.education ?? [];
  for (const line of edu) {
    if (RANGE_RE.test(line) && line.replace(RANGE_RE, "").replace(/[|,\s]/g, "") === "") {
      const last = profile.education.at(-1);
      const r = RANGE_RE.exec(line)!;
      if (last && !last.start) Object.assign(last, { start: r[1], end: r[2] });
      continue;
    }
    const role = splitRoleLine(line);
    if (role) {
      const r = RANGE_RE.exec(line);
      profile.education.push({ degree: role.title, institution: role.company, start: r?.[1], end: r?.[2] });
    }
  }

  // --- Skills ---
  const skillText = (sections.skills ?? []).map((l) => l.replace(/^[^:]{1,30}:\s*/, "")).join(",");
  profile.skills = [...new Set(skillText.split(/\s*[,;|•·]\s*/).map((s) => s.replace(BULLET_RE, "").trim()).filter((s) => s.length > 0 && s.length <= 40))];

  // --- Years of experience ---
  const stated = /(\d{1,2})\+?\s+years?(?:\s+of)?\s+(?:professional\s+|industry\s+)?experience/i.exec((profile.summary ?? text));
  if (stated) {
    profile.totalYearsExperience = sv(Number(stated[1]), 0.75);
  } else {
    const starts = profile.experience.map((e) => (e.start ? parseMonthYear(e.start) : null)).filter((d): d is Date => !!d);
    if (starts.length) {
      const earliest = Math.min(...starts.map((d) => d.getTime()));
      const years = Math.floor((now.getTime() - earliest) / (365.25 * 24 * 3600 * 1000));
      profile.totalYearsExperience = sv(years, 0.5);
    }
  }

  const missing: string[] = [];
  for (const k of ["fullName", "email", "phone", "location", "linkedin"] as const) {
    if (!profile.contact[k]) missing.push(`contact.${k}`);
  }
  if (!profile.experience.length) missing.push("experience");
  if (!profile.education.length) missing.push("education");
  if (!profile.skills.length) missing.push("skills");

  return { profile, missing, sections };
}
