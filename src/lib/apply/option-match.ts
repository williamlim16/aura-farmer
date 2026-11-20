/**
 * Ported from career-ops web/src/lib/apply/option-match.mjs
 * Copyright (c) 2026 Santiago Fernández de Valderrama — MIT License
 * https://github.com/career-ops-hq/career-ops
 *
 * Which option of a select / radio group / combobox the fill step may pick.
 * An exact label (trimmed, case-insensitive) wins. Otherwise only a whole-word
 * match is accepted, and only when exactly one option has it: a substring
 * match let "US" pick "Australia" and "Male" pick "Female". -1 means leave the
 * field for the person.
 */

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export function pickOption(optionTexts: readonly string[], value: string): number {
  const want = norm(value);
  if (!want) return -1;
  const texts = optionTexts.map(norm);
  const exact = texts.indexOf(want);
  if (exact >= 0) return exact;
  const esc = want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, "u");
  const hits = texts.flatMap((t, i) => (word.test(t) ? [i] : []));
  return hits.length === 1 ? hits[0]! : -1;
}

/** Yes/No option for a boolean answer, tolerating "Yes, I am" / "No, I do not". */
export function pickYesNo(optionTexts: readonly string[], yes: boolean): number {
  const want = yes ? "yes" : "no";
  const exact = pickOption(optionTexts, want);
  if (exact >= 0) return exact;
  const starts = optionTexts.flatMap((t, i) => (norm(t).startsWith(`${want},`) || norm(t).startsWith(`${want} `) ? [i] : []));
  return starts.length === 1 ? starts[0]! : -1;
}
