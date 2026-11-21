/**
 * Explainable job-to-profile match (deterministic). Methodology adapted from
 * career-ops (MIT): modes/oferta.md Block B (requirement -> evidence table,
 * importance from the posting, evidence tiers where inference never counts as
 * a hard match) and lib/score-action.mjs (1-5 score bands).
 *
 * Evidence rules:
 *  - "supported": the profile literally states it (quoted evidence).
 *  - "partial": some but not all named skills are stated.
 *  - "inferred": related wording only; shown as inference, half weight.
 *  - "unverified": the profile does not say; never assumed (work rights,
 *    sponsorship, per-skill years always fall here unless the user stated them).
 *  - "gap": the profile states something that does not meet it (e.g. years).
 */
import type { PostingRequirements } from "~/lib/postings/types";
import type { CandidateProfile } from "~/lib/profile/schema";

export type EvidenceStatus = "supported" | "partial" | "inferred" | "unverified" | "gap";

export interface RequirementAssessment {
  text: string;
  importance: "required" | "preferred";
  status: EvidenceStatus;
  /** Quotes from the candidate's profile. Empty when nothing supports it. */
  evidence: string[];
  note?: string;
}

export interface Blocker {
  kind: "work_authorization" | "sponsorship" | "years" | "degree" | "location";
  requirement: string;
  /** "blocker": the profile contradicts it. "check": the profile does not say. */
  severity: "blocker" | "check";
  detail: string;
}

export interface MatchResult {
  method: "deterministic-v1";
  score: number; // 1.0 - 5.0
  band: "strong" | "good" | "partial" | "weak";
  summary: string;
  requirements: RequirementAssessment[];
  blockers: Blocker[];
  matchedSkills: string[];
  missingSkills: string[];
  relevantExperience: { title: string; company: string; why: string }[];
  generatedAt: string;
}

/** Canonical skill -> aliases (lowercase). Kept small and unambiguous. */
const SKILLS: Record<string, string[]> = {
  TypeScript: ["typescript", "ts"],
  JavaScript: ["javascript", "js", "ecmascript"],
  React: ["react", "react.js", "reactjs"],
  "Next.js": ["next.js", "nextjs"],
  "Node.js": ["node.js", "nodejs", "node"],
  Python: ["python"],
  Go: ["golang", "go"],
  Java: ["java"],
  Kotlin: ["kotlin"],
  Rust: ["rust"],
  "C++": ["c++"],
  "C#": ["c#", ".net", "dotnet"],
  Ruby: ["ruby", "rails", "ruby on rails"],
  PHP: ["php"],
  SQL: ["sql"],
  PostgreSQL: ["postgresql", "postgres"],
  MySQL: ["mysql"],
  MongoDB: ["mongodb", "mongo"],
  Redis: ["redis"],
  GraphQL: ["graphql"],
  AWS: ["aws", "amazon web services"],
  GCP: ["gcp", "google cloud"],
  Azure: ["azure"],
  Docker: ["docker", "containers"],
  Kubernetes: ["kubernetes", "k8s"],
  Terraform: ["terraform"],
  "CI/CD": ["ci/cd", "continuous integration", "github actions"],
  Playwright: ["playwright"],
  Cypress: ["cypress"],
  Jest: ["jest"],
  "Automated testing": ["automated testing", "test automation", "testing"],
  Kafka: ["kafka"],
  Spark: ["spark"],
  "Machine learning": ["machine learning", "ml"],
  LLMs: ["llm", "llms", "large language models"],
  Figma: ["figma"],
  Excel: ["excel"],
  Salesforce: ["salesforce"],
};

const STOP = new Set(("a an and or the of to in for with on at by from as is are be have has you your we our will able ability strong excellent experience experienced working knowledge understanding proven solid skills skill years year plus etc using use including include such other related relevant similar good great deep hands-on " +
  // generic verbs/adjectives that say nothing about a candidate's fit
  "about take full user users care deeply part been make help work works drive open minimal high fast know when others through ensure across within things being more most very well want love thrive environment environments teams team people problems problem complete completion direction history track record ability judgment world class").split(" "));

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (text: string, alias: string) => new RegExp(`(^|[^a-z0-9+#.])${esc(alias)}($|[^a-z0-9+#])`, "i").test(text);

export function skillsIn(text: string): string[] {
  return Object.entries(SKILLS).filter(([, aliases]) => aliases.some((a) => has(text, a))).map(([k]) => k);
}

interface Corpus {
  lines: string[]; // quotable profile lines
  text: string;
}

function corpusOf(p: CandidateProfile): Corpus {
  const lines = [
    ...(p.summary ? [p.summary] : []),
    ...(p.skills.length ? [`Skills: ${p.skills.join(", ")}`] : []),
    ...p.experience.flatMap((e) => [`${e.title}, ${e.company}${e.start ? ` (${e.start} - ${e.end ?? ""})` : ""}`, ...e.bullets]),
    ...p.education.map((e) => `${e.degree}, ${e.institution}`),
  ];
  return { lines, text: lines.join("\n").toLowerCase() };
}

const quote = (c: Corpus, alias: string) => c.lines.find((l) => has(l.toLowerCase(), alias));

function degreeLevel(s: string): number {
  const t = s.toLowerCase();
  if (/\b(phd|ph\.d|doctorate)\b/.test(t)) return 3;
  if (/\b(master|msc|m\.s\.|mba|ms)\b/.test(t)) return 2;
  if (/\b(bachelor|bsc|b\.s\.|ba|bs|undergraduate)\b/.test(t)) return 1;
  return 0;
}

function assess(req: string, importance: "required" | "preferred", p: CandidateProfile, c: Corpus, blockers: Blocker[]): RequirementAssessment {
  const lower = req.toLowerCase();
  const prefs = p.preferences;

  // Work authorisation / sponsorship: never inferred.
  if (/sponsor/i.test(req)) {
    if (prefs.needsSponsorship === true && /(no|not|unable|without|cannot)\b[^.]{0,40}sponsor|sponsor\w*[^.]{0,30}\b(not|unavailable)/i.test(req)) {
      blockers.push({ kind: "sponsorship", requirement: req, severity: "blocker", detail: "The posting says sponsorship is not available, and your profile says you need it." });
      return { text: req, importance, status: "gap", evidence: ["Profile: needs visa sponsorship"] };
    }
    if (prefs.needsSponsorship === undefined) {
      blockers.push({ kind: "sponsorship", requirement: req, severity: "check", detail: "Your profile does not say whether you need sponsorship." });
      return { text: req, importance, status: "unverified", evidence: [], note: "Add your sponsorship need on your profile." };
    }
    return { text: req, importance, status: "supported", evidence: [`Profile: ${prefs.needsSponsorship ? "needs" : "does not need"} sponsorship`] };
  }
  if (/authori[sz]ed to work|right to work|work permit|eligible to work|citizen(ship)?\b|permanent resident/i.test(req)) {
    const auth = prefs.workAuthorization ?? {};
    const country = Object.keys(auth).find((k) => lower.includes(k.toLowerCase()));
    if (country && auth[country] === false) {
      blockers.push({ kind: "work_authorization", requirement: req, severity: "blocker", detail: `Your profile says you are not authorised to work in ${country}.` });
      return { text: req, importance, status: "gap", evidence: [`Profile: not authorised in ${country}`] };
    }
    if (country && auth[country]) return { text: req, importance, status: "supported", evidence: [`Profile: authorised to work in ${country}`] };
    blockers.push({ kind: "work_authorization", requirement: req, severity: "check", detail: "Your profile does not state work rights for this location." });
    return { text: req, importance, status: "unverified", evidence: [], note: "Add your work rights for this country on your profile." };
  }

  // Years of experience.
  const yrs = /(\d{1,2})\s*\+?\s*(?:-\s*\d+\s*)?(?:years|yrs)/i.exec(req);
  if (yrs) {
    const need = Number(yrs[1]);
    const total = p.totalYearsExperience?.value;
    const skills = skillsIn(req);
    if (total === undefined) return { text: req, importance, status: "unverified", evidence: [], note: "Your profile does not state total years of experience." };
    if (total < need) {
      if (importance === "required" && need - total >= 2) blockers.push({ kind: "years", requirement: req, severity: "check", detail: `Asks for ${need}+ years; your profile shows about ${total}.` });
      return { text: req, importance, status: "gap", evidence: [`Profile: about ${total} years of experience`] };
    }
    if (skills.length) {
      const stated = skills.filter((s) => SKILLS[s]!.some((a) => quote(c, a)));
      return { text: req, importance, status: stated.length ? "inferred" : "unverified", evidence: [`Profile: about ${total} years of experience in total`, ...stated.map((s) => quote(c, SKILLS[s]!.find((a) => quote(c, a))!)!)], note: "Your profile has total years, not years per skill." };
    }
    return { text: req, importance, status: "supported", evidence: [`Profile: about ${total} years of experience`] };
  }

  // Degree.
  const lvl = degreeLevel(req);
  if (lvl > 0 && /degree|bachelor|master|phd|doctorate|bs\b|ms\b|bsc|msc/i.test(req)) {
    const best = Math.max(0, ...p.education.map((e) => degreeLevel(e.degree)));
    const equivalent = /equivalent|or similar|or related experience|practical experience/i.test(req);
    if (best >= lvl) return { text: req, importance, status: "supported", evidence: p.education.filter((e) => degreeLevel(e.degree) >= lvl).map((e) => `${e.degree}, ${e.institution}`) };
    if (!p.education.length) return { text: req, importance, status: "unverified", evidence: [], note: "No education in your profile." };
    if (importance === "required" && !equivalent) blockers.push({ kind: "degree", requirement: req, severity: "check", detail: "The posting asks for a higher degree than your profile shows." });
    return { text: req, importance, status: equivalent ? "inferred" : "gap", evidence: p.education.map((e) => `${e.degree}, ${e.institution}`), note: equivalent ? "The posting accepts equivalent experience." : undefined };
  }

  // Location / on-site.
  if (/\b(on-?site|in[- ]office|hybrid|relocat\w*|must (?:be )?(?:based|located)|located in)\b/i.test(req)) {
    const loc = p.contact.location?.value;
    const placeHit = loc ? loc.split(",").map((s) => s.trim()).filter((s) => s.length > 2).some((part) => has(lower, part.toLowerCase())) : false;
    if (placeHit) return { text: req, importance, status: "supported", evidence: [`Profile location: ${loc}`] };
    if (prefs.willingToRelocate === true) return { text: req, importance, status: "inferred", evidence: ["Profile: willing to relocate"] };
    if (importance === "required") blockers.push({ kind: "location", requirement: req, severity: "check", detail: loc ? `Check the location requirement against your location (${loc}).` : "Your profile has no location." });
    return { text: req, importance, status: "unverified", evidence: loc ? [`Profile location: ${loc}`] : [] };
  }

  // Named skills.
  const skills = skillsIn(req);
  if (skills.length) {
    const stated = skills.filter((s) => SKILLS[s]!.some((a) => quote(c, a)));
    const quotes = [...new Set(stated.map((s) => quote(c, SKILLS[s]!.find((a) => quote(c, a))!)!))].slice(0, 3);
    const anyOf = /\b(or|any of|one of|such as|e\.g\.)\b/i.test(req);
    if (stated.length === skills.length || (anyOf && stated.length > 0)) return { text: req, importance, status: "supported", evidence: quotes };
    if (stated.length) return { text: req, importance, status: "partial", evidence: quotes, note: `Not found in your profile: ${skills.filter((s) => !stated.includes(s)).join(", ")}.` };
    return { text: req, importance, status: "unverified", evidence: [], note: `Not found in your profile: ${skills.join(", ")}.` };
  }

  // Qualitative: word overlap only, shown as inference.
  // Inference needs >= 2 substantive words (5+ letters, not generic) that occur together in ONE profile line.
  const words = [...new Set(lower.match(/[a-z][a-z+#.-]{4,}/g) ?? [])].filter((w) => !STOP.has(w));
  const wordIn = (l: string, w: string) => new RegExp(`\\b${esc(w)}`, "i").test(l);
  const line = c.lines.find((l) => words.filter((w) => wordIn(l, w)).length >= 2);
  if (line) {
    const hits = words.filter((w) => wordIn(line, w));
    return { text: req, importance, status: "inferred", evidence: [line], note: `Related wording in your profile: ${hits.slice(0, 4).join(", ")}. This is an inference, not a verified match.` };
  }
  return { text: req, importance, status: "unverified", evidence: [] };
}

const WEIGHT: Record<EvidenceStatus, number> = { supported: 1, partial: 0.5, inferred: 0.5, unverified: 0, gap: 0 };

export function matchProfileToPosting(profile: CandidateProfile, reqs: PostingRequirements, now = new Date()): MatchResult {
  const c = corpusOf(profile);
  const blockers: Blocker[] = [];
  const requirements = [
    ...reqs.required.map((r) => assess(r, "required", profile, c, blockers)),
    ...reqs.preferred.map((r) => assess(r, "preferred", profile, c, blockers)),
  ];
  let num = 0;
  let den = 0;
  for (const r of requirements) {
    const w = r.importance === "required" ? 3 : 1;
    den += w;
    num += w * WEIGHT[r.status];
  }
  const coverage = den ? num / den : 0;
  let score = Math.round((1 + 4 * coverage) * 10) / 10;
  if (blockers.some((b) => b.severity === "blocker")) score = Math.min(score, 2.5);
  // Bands mirror career-ops score-action thresholds (4.5 strong, 4.0 apply, 3.0 maybe).
  const band = score >= 4.5 ? "strong" : score >= 4 ? "good" : score >= 3 ? "partial" : "weak";

  const allReqText = [...reqs.required, ...reqs.preferred].join("\n");
  const wanted = skillsIn(allReqText);
  const matchedSkills = wanted.filter((s) => SKILLS[s]!.some((a) => quote(c, a)));
  const missingSkills = wanted.filter((s) => !matchedSkills.includes(s));
  const relevantExperience = profile.experience
    .map((e) => {
      const text = [e.title, ...e.bullets].join(" ");
      const hit = skillsIn(text).filter((s) => wanted.includes(s));
      return { title: e.title, company: e.company, why: hit.length ? `Uses ${hit.join(", ")}` : "" };
    })
    .filter((e) => e.why);

  const counts = (s: EvidenceStatus) => requirements.filter((r) => r.status === s).length;
  const hard = blockers.filter((b) => b.severity === "blocker").length;
  const summary = requirements.length
    ? `${counts("supported")} of ${requirements.length} requirements are stated in your profile, ${counts("partial") + counts("inferred")} are partly supported or inferred, ${counts("unverified")} are not verified and ${counts("gap")} are gaps.${hard ? ` ${hard} hard blocker(s) found.` : ""}`
    : "No requirements were found in this posting. Review and add them to get a match.";

  return { method: "deterministic-v1", score, band, summary, requirements, blockers, matchedSkills, missingSkills, relevantExperience, generatedAt: now.toISOString() };
}
