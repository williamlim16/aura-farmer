/**
 * Renders a tailored resume into the fixed `resume.tex` template.
 *
 * Everything that reaches the .tex file goes through `latexEscape` (or
 * `latexUrl` for links), so neither the LLM output nor profile data nor a job
 * ad can inject LaTeX commands or break compilation. The output uses only
 * the template's own macros, so the layout always matches `resume.tex`.
 */

import { RESUME_PREAMBLE } from "~/server/tailor/resume-template";
import type { TailoredResume } from "~/server/tailor/resume-schema";

export interface ResumeProfile {
  fullName: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  headline: string | null;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
}

export interface ResumeExperience {
  id: string;
  jobTitle: string;
  company: string;
  location: string | null;
  startDate: string;
  endDate: string | null;
  isCurrent: boolean;
}

export interface ResumeEducation {
  id: string;
  school: string;
  degree: string;
  fieldOfStudy: string | null;
  location: string | null;
  startDate: string;
  endDate: string | null;
  isCurrent: boolean;
  grade: string | null;
}

/** Characters pdfLaTeX (with the template's default fonts) can't print as-is. */
const UNICODE_REPLACEMENTS: Record<string, string> = {
  "\u2018": "`",
  "\u2019": "'",
  "\u201C": "``",
  "\u201D": "''",
  "\u2013": "--",
  "\u2014": "---",
  "\u2026": "\\ldots{}",
  "\u2022": "\\textbullet{}",
  "\u00A0": "~",
  "\u2192": "$\\rightarrow$",
  "\u00D7": "$\\times$",
  "\u2264": "$\\leq$",
  "\u2265": "$\\geq$",
};

const SPECIAL_CHARS: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
  "<": "\\textless{}",
  ">": "\\textgreater{}",
  "|": "\\textbar{}",
};

/**
 * Escapes plain text for LaTeX. Line breaks collapse to spaces, and
 * characters outside Latin-1 that we don't have a mapping for are dropped,
 * so a stray emoji can't fail a compile (compiles are rate-limited).
 */
export function latexEscape(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC").replace(/\s+/g, " ").trim()) {
    const special = SPECIAL_CHARS[ch] ?? UNICODE_REPLACEMENTS[ch];
    if (special !== undefined) {
      out += special;
      continue;
    }
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code <= 0x7e) out += ch;
    else if (code >= 0xa0 && code <= 0xff) out += ch; // Latin-1 letters (é, ü, ...)
  }
  // Dropped characters can leave double spaces behind.
  return out.replace(/ {2,}/g, " ").trim();
}

/**
 * Makes a URL safe for `\href{...}`. Only http(s) URLs are allowed; others
 * are dropped (returns null).
 */
export function latexUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(
      /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`,
    );
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // Percent-encoding covers spaces, braces, backslashes, etc.; `%` and `#`
  // still need escaping inside \href.
  return url.href.replace(/[%#]/g, (c) => `\\${c}`);
}

function displayUrl(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");
}

function link(raw: string | null, label?: string): string | null {
  if (!raw?.trim()) return null;
  const href = latexUrl(raw);
  const text = latexEscape(label ?? displayUrl(raw));
  return href ? `\\href{${href}}{${text}}` : text;
}

function dateRange(start: string, end: string | null, isCurrent: boolean) {
  const to = isCurrent ? "Present" : end?.trim();
  return latexEscape(to ? `${start.trim()} - ${to}` : start.trim()).replace(
    / - /,
    " -- ",
  );
}

function resumeItem(title: string, text: string) {
  return `      \\resumeItem{${latexEscape(title)}}\n          {${latexEscape(text)}}`;
}

function header(p: ResumeProfile): string {
  const left: string[] = [`\\textbf{{\\Large ${latexEscape(p.fullName)}}}`];
  if (p.headline?.trim()) left.push(latexEscape(p.headline));
  if (p.location?.trim()) left.push(latexEscape(p.location));

  const right: string[] = [];
  if (p.email?.trim()) {
    // Inside \href only `%` and `#` are special; drop anything that could
    // close the group or start a command.
    const href = p.email
      .trim()
      .replace(/[\\{}\s]/g, "")
      .replace(/[%#]/g, (c) => `\\${c}`);
    right.push(`Email : \\href{mailto:${href}}{${latexEscape(p.email)}}`);
  }
  if (p.phone?.trim()) right.push(`Mobile : ${latexEscape(p.phone)}`);
  const links = [
    link(p.linkedinUrl, "LinkedIn"),
    link(p.githubUrl, "GitHub"),
    link(p.websiteUrl),
  ].filter((l): l is string => l !== null);
  if (links.length) right.push(links.join(" $|$ "));

  const rows = Math.max(left.length, right.length);
  const lines: string[] = [];
  for (let i = 0; i < rows; i++) {
    lines.push(`  ${left[i] ?? ""} & ${right[i] ?? ""}\\\\`);
  }
  return [
    "\\begin{tabular*}{\\textwidth}{l@{\\extracolsep{\\fill}}r}",
    ...lines,
    "\\end{tabular*}",
  ].join("\n");
}

/** Renders the complete .tex document. */
export function renderResume(
  content: TailoredResume,
  profile: ResumeProfile,
  experiences: ResumeExperience[],
  educations: ResumeEducation[],
): string {
  const expById = new Map(experiences.map((e) => [e.id, e]));
  const eduById = new Map(educations.map((e) => [e.id, e]));
  const parts: string[] = [RESUME_PREAMBLE, "", "\\begin{document}", ""];

  parts.push("%----------HEADING-----------------", header(profile), "");

  if (content.summary.length) {
    parts.push(
      "%-----------Professional Summary-----------------",
      "\\section{Professional Summary}",
      "  \\resumeItemListStart",
      ...content.summary.map((b) => resumeItem(b.title, b.text)),
      "  \\resumeItemListEnd",
      "",
    );
  }

  const exps = content.experiences.flatMap((e) => {
    const exp = expById.get(e.experienceId);
    return exp ? [{ exp, bullets: e.bullets }] : [];
  });
  if (exps.length) {
    parts.push(
      "%-----------EXPERIENCE-----------------",
      "\\section{Experience}",
      "  \\resumeSubHeadingListStart",
    );
    for (const { exp, bullets } of exps) {
      parts.push(
        "    \\resumeSubheading",
        `      {${latexEscape(exp.company)}}{${latexEscape(exp.location ?? "")}}`,
        `      {${latexEscape(exp.jobTitle)}}{${dateRange(exp.startDate, exp.endDate, exp.isCurrent)}}`,
      );
      if (bullets.length) {
        parts.push(
          "      \\resumeItemListStart",
          ...bullets.map((b) => resumeItem(b.title, b.text)),
          "      \\resumeItemListEnd",
        );
      }
    }
    parts.push("  \\resumeSubHeadingListEnd", "");
  }

  const skills = content.skills.filter((s) => s.items.length);
  if (skills.length) {
    parts.push(
      "%--------SKILLS------------",
      "\\section{Skills}",
      " \\resumeSubHeadingListStart",
      ...skills.map(
        (s) =>
          `   \\item{\\textbf{${latexEscape(s.category)}}{: ${latexEscape(s.items.join(", "))}}}`,
      ),
      " \\resumeSubHeadingListEnd",
      "",
    );
  }

  const edus = content.educationIds.flatMap((id) => {
    const edu = eduById.get(id);
    return edu ? [edu] : [];
  });
  if (edus.length) {
    parts.push(
      "%-----------EDUCATION-----------------",
      "\\section{Education}",
      "  \\resumeSubHeadingListStart",
    );
    for (const edu of edus) {
      const degree = [
        [edu.degree, edu.fieldOfStudy].filter(Boolean).join(" in "),
        edu.grade,
      ]
        .filter(Boolean)
        .join("; ");
      parts.push(
        "    \\resumeSubheading",
        `      {${latexEscape(edu.school)}}{${latexEscape(edu.location ?? "")}}`,
        `      {${latexEscape(degree)}}{${dateRange(edu.startDate, edu.endDate, edu.isCurrent)}}`,
      );
    }
    parts.push("  \\resumeSubHeadingListEnd", "");
  }

  parts.push(
    "%-------------------------------------------",
    "\\end{document}",
    "",
  );
  return parts.join("\n");
}
