/**
 * Resume tailoring from verified facts only. Suggestions reorder or rephrase
 * using facts already in the profile; nothing is ever added. The original
 * profile is kept; the tailored version is a separate object, checked by
 * verifyNoNewFacts before use.
 */
import type { MatchResult } from "~/lib/match/match";
import { skillsIn } from "~/lib/match/match";
import type { CandidateProfile } from "~/lib/profile/schema";

export type SuggestionKind = "skills_order" | "summary" | "bullets_order";

export interface TailorSuggestion {
  id: string;
  kind: SuggestionKind;
  title: string;
  before: string[];
  after: string[];
  rationale: string;
  /** For bullets_order: index of the experience entry. */
  experienceIndex?: number;
  status: "pending" | "accepted" | "rejected";
}

export interface DraftAnswer {
  id: "why_company" | "notice_period" | "salary" | "work_rights";
  question: string;
  answer: string;
  /** "profile": copied from stated facts. "template": generic draft built from facts; always needs review. */
  source: "profile" | "template";
  status: "pending" | "accepted" | "rejected";
}

export interface Tailoring {
  suggestions: TailorSuggestion[];
  answers: DraftAnswer[];
  /** Set when a tailored PDF has been generated. */
  tailoredResumeId?: string | null;
  generatedAt: string;
}

const relevance = (text: string, wanted: Set<string>, words: string[]) => skillsIn(text).filter((s) => wanted.has(s)).length * 2 + words.filter((w) => text.toLowerCase().includes(w)).length;

export function suggestTailoring(p: CandidateProfile, posting: { title: string; company: string; description: string }, match: MatchResult, now = new Date()): Tailoring {
  const wanted = new Set([...match.matchedSkills, ...match.missingSkills]);
  const titleWords = posting.title.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  const suggestions: TailorSuggestion[] = [];

  // 1. Skills: matched skills first (same set, different order).
  if (p.skills.length > 1) {
    const matchedLower = new Set(match.matchedSkills.map((s) => s.toLowerCase()));
    const isMatched = (s: string) => skillsIn(s).some((k) => wanted.has(k)) || matchedLower.has(s.toLowerCase());
    const after = [...p.skills.filter(isMatched), ...p.skills.filter((s) => !isMatched(s))];
    if (after.join("|") !== p.skills.join("|")) {
      suggestions.push({ id: "skills", kind: "skills_order", title: "Put the skills this job asks for first", before: p.skills, after, rationale: `The posting mentions ${match.matchedSkills.join(", ") || "some of your skills"}.`, status: "pending" });
    }
  }

  // 2. Bullets: most relevant first within each role.
  p.experience.forEach((e, i) => {
    if (e.bullets.length < 2) return;
    const scored = e.bullets.map((b, j) => ({ b, j, s: relevance(b, wanted, titleWords) }));
    const after = [...scored].sort((a, b) => b.s - a.s || a.j - b.j).map((x) => x.b);
    if (after.join("|") !== e.bullets.join("|")) {
      suggestions.push({ id: `bullets-${i}`, kind: "bullets_order", experienceIndex: i, title: `Lead with your most relevant work at ${e.company}`, before: e.bullets, after, rationale: "These bullets mention what the posting asks for.", status: "pending" });
    }
  });

  // 3. Summary built only from stated facts.
  const latest = p.experience[0];
  const years = p.totalYearsExperience?.value;
  if (latest && match.matchedSkills.length) {
    const parts = [`${latest.title}${years !== undefined ? ` with ${years} years of experience` : ""}`, `working with ${match.matchedSkills.slice(0, 5).join(", ")}`];
    const after = `${parts.join(", ")}.`;
    if (after !== p.summary) {
      suggestions.push({ id: "summary", kind: "summary", title: "Focus your summary on this role", before: p.summary ? [p.summary] : [], after: [after], rationale: "Built only from your current title, total years and skills the posting mentions.", status: "pending" });
    }
  }

  // Draft answers: facts copied from the profile; one generic template that must be reviewed.
  const prefs = p.preferences;
  const answers: DraftAnswer[] = [];
  if (latest) {
    const top = match.matchedSkills.slice(0, 3).join(", ");
    answers.push({
      id: "why_company",
      question: `Why are you interested in ${posting.company}?`,
      answer: `I'm a ${latest.title}${top ? ` working with ${top}` : ""}, and the ${posting.title} role matches the work I want to do next. [Edit this draft: add what specifically draws you to ${posting.company}.]`,
      source: "template",
      status: "pending",
    });
  }
  if (prefs.noticePeriod) answers.push({ id: "notice_period", question: "What is your notice period?", answer: prefs.noticePeriod, source: "profile", status: "pending" });
  if (prefs.salaryExpectation) answers.push({ id: "salary", question: "What are your salary expectations?", answer: prefs.salaryExpectation, source: "profile", status: "pending" });
  const auth = Object.entries(prefs.workAuthorization ?? {});
  if (auth.length) answers.push({ id: "work_rights", question: "Work rights", answer: auth.map(([c, ok]) => `${ok ? "Authorised" : "Not authorised"} to work in ${c}`).join("; "), source: "profile", status: "pending" });

  return { suggestions, answers, tailoredResumeId: null, generatedAt: now.toISOString() };
}

/** Apply accepted suggestions to a copy of the profile. */
export function applyTailoring(p: CandidateProfile, t: Tailoring): CandidateProfile {
  const out = structuredClone(p);
  for (const s of t.suggestions) {
    if (s.status !== "accepted") continue;
    if (s.kind === "skills_order") out.skills = [...s.after];
    if (s.kind === "summary") out.summary = s.after[0];
    if (s.kind === "bullets_order" && s.experienceIndex !== undefined && out.experience[s.experienceIndex]) out.experience[s.experienceIndex]!.bullets = [...s.after];
  }
  // Approved answers become saved answers the autofill rules can use.
  const saved: Record<string, string> = { ...(out.preferences.savedAnswers ?? {}) };
  for (const a of t.answers) if (a.status === "accepted" && a.answer.trim()) saved[`@${a.id}`] = a.answer.trim();
  out.preferences.savedAnswers = saved;
  verifyNoNewFacts(p, out);
  return out;
}

/** Throws if the tailored profile contains a skill, bullet, role, degree or summary fact not in the original. */
export function verifyNoNewFacts(original: CandidateProfile, tailored: CandidateProfile): void {
  const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");
  if (!same(original.skills, tailored.skills)) throw new Error("Tailoring changed the set of skills.");
  if (original.experience.length !== tailored.experience.length) throw new Error("Tailoring changed the experience entries.");
  original.experience.forEach((e, i) => {
    const t = tailored.experience[i]!;
    if (e.title !== t.title || e.company !== t.company || e.start !== t.start || e.end !== t.end) throw new Error("Tailoring changed a role.");
    if (!same(e.bullets, t.bullets)) throw new Error("Tailoring changed experience bullets.");
  });
  if (JSON.stringify(original.education) !== JSON.stringify(tailored.education)) throw new Error("Tailoring changed education.");
  if (tailored.summary && tailored.summary !== original.summary) {
    // A rewritten summary may only use: current title, total years, and skills from the profile.
    const allowed = new Set([...original.skills.map((s) => s.toLowerCase()), ...(original.experience[0]?.title.toLowerCase().split(/\s+/) ?? [])]);
    for (const s of skillsIn(tailored.summary)) if (![...allowed].some((a) => skillsIn(a).includes(s))) throw new Error(`Summary mentions ${s}, which is not in the profile.`);
    const yrs = /(\d+) years/.exec(tailored.summary);
    if (yrs && Number(yrs[1]) !== original.totalYearsExperience?.value) throw new Error("Summary states a different number of years.");
  }
}
