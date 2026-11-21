/**
 * Deterministic resume text -> CandidateProfile parser.
 *
 * Handles the common single-column layouts (contact header, then headed
 * sections). Anything it cannot find is reported in `missing`, so an LLM
 * extractor can be asked for only those fields instead of the whole resume.
 * Pure function: no I/O, safe to unit test and to run on the client.
 */
import { skillsIn } from "~/lib/match/match";
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

const stripRange = (l: string) => l.replace(RANGE_RE, "").replace(/[|,·•\s]+$/, "").replace(/^[|,·•\s]+/, "").trim();
const SINGLE_YEAR_RE = /\b((?:19|20)\d{2})\b()/;
const TITLE_WORD = /\b(engineer|developer|manager|analyst|designer|lead|intern|consultant|architect|scientist|specialist|director|officer|administrator|coordinator|associate|assistant|head|programmer|technician)\b/i;
const DEGREE_WORD = /\b(bachelor|master|ph\.?d|doctor|diploma|certificate|associate degree|b\.?sc|m\.?sc|b\.?a\b|m\.?a\b|b\.?eng|m\.?eng|mba|honours|honors)\b/i;
const SCHOOL_WORD = /\b(university|college|institute|school|academy|polytechnic|tafe)\b/i;

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

  // Location may share the contact line ("Sydney, NSW · email · phone"): split on separators first.
  const headerTokens = header.filter((l) => l !== nameLine).flatMap((l) => l.split(/\s*[·•|\t]\s*|\s{2,}/)).map((t) => t.trim()).filter(Boolean);
  const locationLine = headerTokens.find((t) => looksLikeLocation(t));
  if (locationLine) profile.contact.location = sv(locationLine.trim(), 0.7);

  // --- Summary ---
  if (sections.summary?.length) profile.summary = sections.summary.join(" ");

  // --- Experience ---
  // Supported layouts (dates may be on the title line, the company line, or alone):
  //   "Title, Company | Mar 2021 - Present"        "Title at Company"
  //   "Title    Mar 2021 - Present" + "Company - City"
  //   "Company    Mar 2021 - Present" + "Title"     (swapped when the 2nd line is the title)
  // Wrapped bullet lines are appended to the previous bullet.
  const exp = sections.experience ?? [];
  let lastWasBullet = false;
  for (let i = 0; i < exp.length; i++) {
    const line = exp[i]!;
    if (BULLET_RE.test(line)) {
      profile.experience.at(-1)?.bullets.push(line.replace(BULLET_RE, ""));
      lastWasBullet = true;
      continue;
    }
    const range = RANGE_RE.exec(line);
    const rest = stripRange(line);
    if (range && !rest) {
      // date-only line: belongs to the entry just started
      const last = profile.experience.at(-1);
      if (last && !last.start) Object.assign(last, { start: range[1], end: range[2] });
      lastWasBullet = false;
      continue;
    }
    const nextRange = exp[i + 1] ? RANGE_RE.exec(exp[i + 1]!) : null;
    const nextIsDateOnly = !!nextRange && !stripRange(exp[i + 1]!);
    const role = splitRoleLine(line);
    if (role && (range || nextIsDateOnly)) {
      const r = range ?? nextRange!;
      profile.experience.push({ ...role, start: r[1], end: r[2], bullets: [] });
      lastWasBullet = false;
      continue;
    }
    if (range && rest) {
      // "Title    dates" with the company on the next non-bullet line (or swapped)
      const next = exp[i + 1] && !BULLET_RE.test(exp[i + 1]!) && !RANGE_RE.test(exp[i + 1]!) ? exp[i + 1]! : null;
      const second = next ? next.split(/\s+[—–|·]\s+|\s+-\s+|,\s+(?=[A-Z][a-z]+,?\s+[A-Z]{2,3}\b)/)[0]!.trim() : "";
      let title = rest;
      let company = second;
      if (company && TITLE_WORD.test(company) && !TITLE_WORD.test(title)) [title, company] = [company, title];
      profile.experience.push({ title, company, start: range[1], end: range[2], bullets: [] });
      if (next) i++;
      lastWasBullet = false;
      continue;
    }
    // "Company" + "Title" + date-only line (either order of the first two).
    const dateOnly = (k: number) => !!exp[k] && RANGE_RE.test(exp[k]) && !stripRange(exp[k]);
    const plain = (k: number) => !!exp[k] && !BULLET_RE.test(exp[k]) && !RANGE_RE.test(exp[k]);
    if (plain(i + 1) && dateOnly(i + 2) && (TITLE_WORD.test(line) || TITLE_WORD.test(exp[i + 1]!))) {
      const [title, company] = TITLE_WORD.test(exp[i + 1]!) && !TITLE_WORD.test(line) ? [exp[i + 1]!, line] : [line, exp[i + 1]!];
      const r = RANGE_RE.exec(exp[i + 2]!)!;
      profile.experience.push({ title, company, start: r[1], end: r[2], bullets: [] });
      i += 2;
      lastWasBullet = false;
      continue;
    }
    if (dateOnly(i + 1) && TITLE_WORD.test(line)) {
      const r = RANGE_RE.exec(exp[i + 1]!)!;
      profile.experience.push({ title: line, company: "", start: r[1], end: r[2], bullets: [] });
      i += 1;
      lastWasBullet = false;
      continue;
    }
    // Continuation of a wrapped bullet, or free text under the current role.
    const last = profile.experience.at(-1);
    if (last) {
      if (lastWasBullet && last.bullets.length) last.bullets[last.bullets.length - 1] += ` ${line}`;
      else last.bullets.push(line);
    }
  }

  // --- Education ---
  const edu = sections.education ?? [];
  for (let i = 0; i < edu.length; i++) {
    const line = edu[i]!;
    if (BULLET_RE.test(line)) continue;
    const range = RANGE_RE.exec(line) ?? SINGLE_YEAR_RE.exec(line);
    const rest = stripRange(line).replace(/\b(19|20)\d{2}\b\s*$/, "").trim();
    if (range && !rest) {
      const last = profile.education.at(-1);
      if (last && !last.start) Object.assign(last, { start: range[1], end: range[2] ?? range[1] });
      continue;
    }
    const role = splitRoleLine(line);
    if (role && DEGREE_WORD.test(role.title + " " + role.company)) {
      const [degree, institution] = DEGREE_WORD.test(role.title) ? [role.title, role.company] : [role.company, role.title];
      profile.education.push({ degree, institution, start: range?.[1], end: range?.[2] ?? range?.[1] });
      continue;
    }
    if (rest && (DEGREE_WORD.test(rest) || SCHOOL_WORD.test(rest))) {
      // "Degree    2014 - 2017" + "University" on the next line (either order)
      const next = edu[i + 1] && !BULLET_RE.test(edu[i + 1]!) ? stripRange(edu[i + 1]!) : "";
      const pairOk = next && (DEGREE_WORD.test(rest) ? SCHOOL_WORD.test(next) || !DEGREE_WORD.test(next) : DEGREE_WORD.test(next));
      const degree = DEGREE_WORD.test(rest) ? rest : pairOk ? next : rest;
      const institution = DEGREE_WORD.test(rest) ? (pairOk ? next : "") : rest;
      const nr = !range && edu[i + 1] ? RANGE_RE.exec(edu[i + 1]!) : null;
      profile.education.push({ degree, institution, start: (range ?? nr)?.[1], end: (range ?? nr)?.[2] ?? range?.[1] });
      if (pairOk) i++;
    }
  }

  // --- Skills ---
  const skillText = (sections.skills ?? []).map((l) => l.replace(/^[^:]{1,30}:\s*/, "")).join(",");
  const rawSkills = skillText.split(/\s*[,;|•·]\s*|\s{2,}|\t/).map((s) => s.replace(BULLET_RE, "").trim()).filter(Boolean);
  // A run with no separators ("Python Java SQL Excel", from tables) is split into known skills.
  const expanded = rawSkills.flatMap((s) => {
    const known = skillsIn(s);
    return s.length > 25 && known.length >= 2 && s.split(/\s+/).length <= known.length * 2 + 1 ? known : [s];
  });
  profile.skills = [...new Set(expanded.filter((s) => s.length <= 40))];

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
