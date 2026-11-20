/**
 * Tier A: deterministic rules. Maps a classified field to a profile fact.
 * Never guesses: if the profile does not state the fact, it abstains (or, for
 * sensitive kinds, hands the field to the person).
 */
import type { CandidateProfile } from "~/lib/profile/schema";
import { pickOption, pickYesNo } from "../option-match";
import type { Decision, FieldKind, FormField } from "../types";
import type { DecisionContext, DecisionInput, DecisionProvider } from "./types";

const fill = (value: string | boolean, confidence: number): Decision => ({ action: "fill", value, tier: "rule", confidence });
const human = (reason: string): Decision => ({ action: "human", reason, tier: "rule" });

/** Resolve a string answer against the field's options (select/radio) if any. */
function fitToField(field: FormField, value: string, confidence: number): Decision | null {
  if (field.control === "select" || field.control === "radio" || (field.control === "combobox" && field.options.length)) {
    const i = pickOption(field.options, value);
    return i >= 0 ? fill(field.options[i]!, confidence) : null;
  }
  return fill(value, confidence);
}

function fitBoolean(field: FormField, yes: boolean): Decision | null {
  if (field.control === "select" || field.control === "radio" || field.control === "combobox") {
    const i = pickYesNo(field.options, yes);
    return i >= 0 ? fill(field.options[i]!, 0.95) : null;
  }
  if (field.control === "checkbox") return fill(yes, 0.9);
  return fill(yes ? "Yes" : "No", 0.9);
}

/** Which country a work-authorisation question is about, if it names one we know. */
function countryInLabel(label: string, countries: string[]): string | null {
  const l = label.toLowerCase();
  const hits = countries.filter((c) => new RegExp(`(^|[^a-z])${c.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(l));
  return hits.length === 1 ? hits[0]! : null;
}

const normQ = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

function contactValue(p: CandidateProfile, kind: FieldKind): { value: string; confidence: number } | null {
  const c = p.contact;
  const pick = (v?: { value: string; confidence: number }) => (v ? { value: v.value, confidence: v.confidence } : null);
  switch (kind) {
    case "first_name": return pick(c.firstName);
    case "last_name": return pick(c.lastName);
    case "full_name": return pick(c.fullName);
    case "email": return pick(c.email);
    case "phone": return pick(c.phone);
    case "location": return pick(c.location);
    case "linkedin": return pick(c.linkedin);
    case "github": return pick(c.github);
    case "website": return pick(c.website);
    case "current_title": return p.experience[0] ? { value: p.experience[0].title, confidence: 0.8 } : null;
    case "current_company": return p.experience[0] ? { value: p.experience[0].company, confidence: 0.8 } : null;
    default: return null;
  }
}

export function decideByRule(input: DecisionInput, ctx: DecisionContext): Decision | null {
  const { field, classification: cls } = input;
  const p = ctx.profile;
  const prefs = p.preferences;

  // A saved answer for this exact question wins for any non-sensitive field.
  const saved = prefs.savedAnswers?.[normQ(field.label)];
  if (saved && field.label) return fitToField(field, saved, 1);

  switch (cls.kind) {
    case "third_party":
      return human("Asks about another person (referrer/reference); not in your profile.");
    case "resume":
      return ctx.hasResume ? { action: "upload", file: "resume", tier: "rule", confidence: 0.95 } : human("No resume on file.");
    case "cover_letter":
      return field.control === "file" ? { action: "skip", reason: "No cover letter file; optional upload left empty.", tier: "rule" } : null;
    case "work_authorization": {
      const map = prefs.workAuthorization ?? {};
      const countries = Object.keys(map);
      if (!countries.length) return human("Work authorisation not stated in profile.");
      const country = countryInLabel(field.label, countries) ?? (countries.length === 1 ? countries[0]! : null);
      if (!country) return human("Question does not name a country we have an answer for.");
      return fitBoolean(field, map[country]!) ?? human("Could not map answer to the field's options.");
    }
    case "sponsorship":
      return prefs.needsSponsorship === undefined
        ? human("Sponsorship need not stated in profile.")
        : (fitBoolean(field, prefs.needsSponsorship) ?? human("Could not map answer to the field's options."));
    case "salary":
      return prefs.salaryExpectation ? fitToField(field, prefs.salaryExpectation, 1) : human("Salary expectation not stated.");
    case "notice_period":
      return prefs.noticePeriod ? fitToField(field, prefs.noticePeriod, 1) : human("Notice period not stated.");
    case "start_date":
      return prefs.earliestStartDate ? fitToField(field, prefs.earliestStartDate, 1) : human("Start date not stated.");
    case "relocation":
      return prefs.willingToRelocate === undefined ? human("Relocation preference not stated.") : fitBoolean(field, prefs.willingToRelocate);
    case "country": {
      // Last segment of a stated location ("Melbourne, VIC, Australia" -> "Australia").
      const loc = p.contact.location;
      const country = loc?.value.split(",").pop()?.trim();
      return country ? fitToField(field, country, Math.min(loc!.confidence, 0.8)) : null;
    }
    case "referral_source":
      return prefs.referralSource ? fitToField(field, prefs.referralSource, 1) : null;
    case "years_experience": {
      const y = p.totalYearsExperience;
      // Skill-specific years ("years with Kubernetes") are not the total.
      if (!y || /\b(?:with|in|using)\s+\w/i.test(field.label)) return null;
      if (field.control === "select" || field.control === "radio") {
        const i = field.options.findIndex((o) => {
          const m = /(\d+)\s*(?:-|–|to)\s*(\d+)|(\d+)\s*\+|less than\s*(\d+)|^(\d+)$/i.exec(o);
          if (!m) return false;
          if (m[1]) return y.value >= Number(m[1]) && y.value <= Number(m[2]);
          if (m[3]) return y.value >= Number(m[3]);
          if (m[4]) return y.value < Number(m[4]);
          return y.value === Number(m[5]);
        });
        return i >= 0 ? fill(field.options[i]!, y.confidence) : null;
      }
      return fill(String(y.value), y.confidence);
    }
    default: {
      const v = contactValue(p, cls.kind);
      // "City" fields want "Melbourne", not "Melbourne, VIC, Australia".
      if (v && cls.kind === "location" && /\bcity\b|\bsuburb\b/i.test(field.label) && !/country|address/i.test(field.label)) {
        return fitToField(field, v.value.split(",")[0]!.trim(), Math.min(v.confidence, cls.confidence));
      }
      return v ? fitToField(field, v.value, Math.min(v.confidence, cls.confidence)) : null;
    }
  }
}

export class RuleProvider implements DecisionProvider {
  readonly tier = "rule" as const;
  readonly name = "rules";
  async decideMany(inputs: DecisionInput[], ctx: DecisionContext) {
    const out = new Map<string, Decision>();
    for (const input of inputs) {
      const d = decideByRule(input, ctx);
      if (d) out.set(input.field.id, d);
    }
    return out;
  }
}
