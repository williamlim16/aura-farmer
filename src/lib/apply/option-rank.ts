/**
 * Deterministic matching of a person's own answer to a form's real options.
 * Never invents an option: the result is always an index into `options`, or
 * a ranked list of candidates for the person to choose from.
 *
 *  exact     the answer equals an option (case/punctuation-insensitive)
 *  close     equal after canonicalising well-known equivalents (Man = Male,
 *            He/Him = He/Him/His, "Decline" = "Prefer not to say"), or the
 *            answer is the leading words of exactly one option ("Bachelor" ->
 *            "Bachelor's Degree")
 *  suggest   exactly one option shares the most meaningful words with the
 *            answer; a SUGGESTION only, the person confirms it
 *  ambiguous several options fit equally; the person chooses
 *  none      nothing in the list relates to the answer
 */
export type OptionRank =
  | { kind: "exact"; index: number; candidates: number[] }
  | { kind: "close"; index: number; candidates: number[] }
  | { kind: "suggest"; index: number; candidates: number[] }
  | { kind: "ambiguous"; candidates: number[] }
  | { kind: "none"; candidates: number[] };

const strip = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .replace(/[’']/g, "");

const words = (s: string) => strip(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** Plural / possessive-insensitive form ("Bachelors" = "Bachelor's"): trailing s dropped from longer words. */
const stem = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const flat = (s: string) => words(s).map(stem).join(" ");
/** Unstemmed, for the fixed phrase table below. */
const plain = (s: string) => words(s).join(" ");

/** Phrases that mean the same thing on forms, mapped to one canonical token. */
const CANON: [RegExp, string][] = [
  [/\bnon[ -]?binary\b|\bnb\b|\benby\b/g, "nonbinary"],
  [/\bwoman\b|\bwomen\b|\bfemale\b/g, "female"],
  [/\bman\b|\bmen\b|\bmale\b/g, "male"],
  [/\bhe\b(?: ?him)?(?: ?his)?\b/g, "hehimhis"],
  [/\bshe\b(?: ?her)?(?: ?hers)?\b/g, "sheherhers"],
  [/\bthey\b(?: ?them)?(?: ?theirs)?\b/g, "theythemtheirs"],
  [/\bprefer not to (say|answer|disclose|state)\b|\bdecline(?: to (answer|say|state|disclose))?\b|\brather not (say|answer)\b|\bi (?:do not|don t|dont) wish to (answer|say|disclose)\b/g, "prefernot"],
];

function canon(s: string): string {
  let t = plain(s);
  for (const [re, to] of CANON) t = t.replace(re, to);
  return t.replace(/\s+/g, " ").trim();
}

const STOP = new Set(["of", "the", "a", "an", "and", "in", "for", "to", "at", "or", "is", "are", "i", "am", "you", "my", "degree", "other"]);
const significant = (s: string) => words(s).map(stem).filter((w) => w.length > 1 && !STOP.has(w));

export function rankOptions(options: readonly string[], answer: string): OptionRank {
  const a = flat(answer);
  if (!a || options.length === 0) return { kind: "none", candidates: [] };

  const flats = options.map(flat);
  const exact = flats.flatMap((o, i) => (o === a ? [i] : []));
  if (exact.length === 1) return { kind: "exact", index: exact[0]!, candidates: exact };

  const ca = canon(answer);
  const cans = options.map(canon);
  const same = cans.flatMap((o, i) => (o === ca ? [i] : []));
  if (same.length === 1) return { kind: "close", index: same[0]!, candidates: same };

  // Leading words: "Bachelor" -> "Bachelor's Degree"; "Yes" -> three "Yes, ..." options (ambiguous).
  const aw = a.split(" ");
  const lead = flats.flatMap((o, i) => (o.split(" ").slice(0, aw.length).join(" ") === a && o !== a ? [i] : []));
  if (lead.length === 1) return { kind: "close", index: lead[0]!, candidates: lead };
  if (lead.length > 1) return { kind: "ambiguous", candidates: lead };

  // Shared meaningful words.
  const mine = new Set(significant(answer));
  if (mine.size === 0) return { kind: "none", candidates: [] };
  const scored = options.map((o, i) => ({ i, n: significant(o).filter((w) => mine.has(w)).length })).filter((x) => x.n > 0);
  if (!scored.length) return { kind: "none", candidates: [] };
  const best = Math.max(...scored.map((x) => x.n));
  const top = scored.filter((x) => x.n === best).map((x) => x.i);
  return top.length === 1 ? { kind: "suggest", index: top[0]!, candidates: top } : { kind: "ambiguous", candidates: top };
}
