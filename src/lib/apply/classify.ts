/**
 * Deterministic field classification: which profile fact a form field asks for.
 *
 * Signal order (most to least reliable): HTML autocomplete tokens, input type,
 * label text, name/id attributes. Sensitive categories are checked before
 * generic ones, so "Current salary" is salary_history (never filled), not
 * salary. Question patterns for sensitive kinds are adapted from career-ops
 * web/src/lib/apply/blank-unknown.mjs (MIT).
 */
import { isAiDirectedText } from "./ai-directed";
import type { Classification, FieldKind, FormField } from "./types";

const AUTOCOMPLETE: Record<string, FieldKind> = {
  "given-name": "first_name",
  "family-name": "last_name",
  name: "full_name",
  email: "email",
  tel: "phone",
  "tel-national": "phone",
  "address-level2": "location",
  "organization-title": "current_title",
  organization: "current_company",
  url: "website",
};

type Rule = [FieldKind, RegExp];

// Order matters: first match wins.
const LABEL_RULES: Rule[] = [
  ["eeo", /gender|\brac(?:e|ial)\b|ethnic|veteran|disabilit|self-identif|pronouns?\b|hispanic|latin[oa]|sexual orientation|\bsex\b/],
  ["legal", /felony|conviction|convicted|criminal (?:background|record|history)/],
  ["salary_history", /salary history|compensation history|pay history|\b(?:current|previous|prior|last) (?:base )?(?:salary|compensation|pay|wage)\b/],
  ["consent", /\b(?:i agree|i consent|i accept|i acknowledge|i certify|terms (?:and|&) conditions|privacy (?:policy|notice)|data processing|gdpr)\b/],
  ["third_party", /referr(?:er|ing)|who referred you|\breference(?:s)?\b.*\b(?:name|email|phone|contact)|emergency contact|next of kin/],
  ["sponsorship", /sponsor/],
  ["work_authorization", /authori[sz]ed to work|work authori[sz]ation|right to work|eligible to work|legally (?:able|permitted) to work|work permit|visa status/],
  ["salary", /salary|compensation|pay expectation|desired pay|expected (?:pay|rate)|\bwage\b|rate expectation/],
  ["notice_period", /notice period/],
  ["start_date", /start date|earliest start|when can you start|date you can start|availability to start/],
  ["relocation", /relocat/],
  ["referral_source", /how did you (?:hear|find|learn)|where did you (?:hear|find|see)|referral source|source of application/],
  ["years_experience", /years of (?:relevant |professional |total )?experience|how many years/],
  ["resume", /\b(?:resume|résumé|cv|curriculum vitae)\b/],
  ["cover_letter", /cover letter|motivation letter/],
  ["linkedin", /linked\s?in/],
  ["github", /github/],
  ["website", /portfolio|personal (?:website|site)|\bwebsite\b|blog\b/],
  ["first_name", /\b(?:first|given|fore)\s?name\b|\bpreferred first name\b/],
  ["last_name", /\b(?:last|family|sur)\s?name\b|\bsurname\b/],
  ["full_name", /^(?:full |legal |your )?name\b|^name$|\bfull name\b/],
  ["email", /e-?mail/],
  ["phone", /phone|mobile|cell|telephone|contact number/],
  ["current_company", /current (?:company|employer)|most recent (?:company|employer)|^(?:company|employer)$/],
  ["current_title", /current (?:job )?(?:title|role|position)|^(?:job )?title$/],
  ["education_level", /highest (?:level of )?(?:education|degree)|education level|level of education/],
  ["country", /\bcountry\b(?! code)/],
  ["location", /\b(?:location|city|where are you (?:based|located)|current address|suburb)\b/],
  ["essay", /why (?:do you|are you|us\b|this|join|our)|tell us|describe|cover note|additional information|anything else|what (?:excites|interests|motivates)/],
];

const NAME_ATTR_RULES: Rule[] = [
  ["first_name", /^(?:first_?name|firstname|fname|given_?name)$/],
  ["last_name", /^(?:last_?name|lastname|lname|surname|family_?name)$/],
  ["full_name", /^(?:full_?name|name|candidate_?name)$/],
  ["email", /e_?mail/],
  ["phone", /phone|mobile|tel/],
  ["linkedin", /linkedin/],
  ["github", /github/],
  ["website", /website|portfolio|url/],
  ["resume", /resume|cv/],
  ["cover_letter", /cover_?letter/],
  ["location", /location|city/],
];

const norm = (s: string) => s.toLowerCase().replace(/[*:]+/g, " ").replace(/\s+/g, " ").trim();

export function classifyField(field: FormField): Classification {
  const label = norm(field.label);
  const allText = [field.label, ...field.options];

  // Safety first: questions addressed to an AI filler are never answered.
  if (isAiDirectedText(allText)) return { kind: "ai_directed", confidence: 1, signal: "label" };

  if (field.control === "file") {
    const k: FieldKind = label.includes('cover') || field.name.toLowerCase().includes('cover') ? "cover_letter" : "resume";
    return { kind: k, confidence: label || field.name ? 0.9 : 0.6, signal: label ? "label" : "input-type" };
  }

  // A checkbox whose label is a consent/attestation must never be ticked by us.
  if (field.control === "checkbox" && LABEL_RULES.find(([k]) => k === "consent")![1].test(label)) {
    return { kind: "consent", confidence: 1, signal: "label" };
  }

  // Sensitive label matches outrank autocomplete (a field can be mis-tagged).
  for (const [kind, re] of LABEL_RULES.slice(0, 4)) {
    if (re.test(label)) return { kind, confidence: 0.95, signal: "label" };
  }

  const ac = field.autocomplete.toLowerCase().split(/\s+/).pop() ?? "";
  if (AUTOCOMPLETE[ac]) return { kind: AUTOCOMPLETE[ac], confidence: 0.98, signal: "autocomplete" };

  if (field.control === "email") return { kind: "email", confidence: 0.95, signal: "input-type" };
  if (field.control === "tel") return { kind: "phone", confidence: 0.9, signal: "input-type" };

  if (label) {
    for (const [kind, re] of LABEL_RULES.slice(4)) {
      if (re.test(label)) {
        // Labels found by proximity rather than markup are less certain.
        const base = field.labelSource === "nearby-text" || field.labelSource === "placeholder" ? 0.75 : 0.9;
        return { kind, confidence: base, signal: "label" };
      }
    }
  }

  const attr = norm(field.name || field.htmlId).replace(/[\[\]-]/g, "_");
  for (const [kind, re] of NAME_ATTR_RULES) {
    if (re.test(attr)) return { kind, confidence: 0.7, signal: "name-attr" };
  }

  if (field.control === "textarea") return { kind: "essay", confidence: 0.5, signal: "input-type" };
  return { kind: "unknown", confidence: 0, signal: "none" };
}
