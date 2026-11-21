/**
 * Job description text processing: HTML -> text and requirement extraction.
 * Pure. Section heading patterns follow common ATS posting layouts.
 */
import type { PostingRequirements } from "./types";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " ", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", hellip: "…", bull: "•", middot: "·" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e: string) => {
    if (e.startsWith("#")) {
      const n = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Block-aware HTML to plain text: list items become "- " lines, headings own lines. */
export function htmlToText(html: string): string {
  let s = html;
  // Greenhouse returns HTML-escaped HTML in `content`.
  if (/&lt;\/?[a-z]/i.test(s) && !/<\/?[a-z]/i.test(s)) s = decodeEntities(s);
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<li[^>]*>/gi, "\n- ").replace(/<\/(p|div|h[1-6]|ul|ol|li|section|tr)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<h[1-6][^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s).replace(/[​-‍﻿]/g, "");
  return s.split("\n").map((l) => l.replace(/[ \t ]+/g, " ").trim()).filter((l, i, a) => l || (i > 0 && a[i - 1])).join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 50_000);
}

const REQUIRED_HEAD = /^(requirements|qualifications|minimum qualifications|basic qualifications|required qualifications|core requirements|what we require|what you('|’)ll (need|bring)|what we('|’)re looking for|what you (need|bring)|who you are|you (have|bring|are|might be)|you('ll| will)? ?(might |may )?thrive|(the )?ideal candidate|you may be a (good )?fit|we('|’)d love (to hear from you|you to have)|about you|skills (and|&) experience|must[- ]haves?)\b/i;
const PREFERRED_HEAD = /^(preferred( qualifications| requirements)?|nice[- ]to[- ]haves?|bonus( points)?|it('|’)s a plus|pluses|desired|good to have|what we value|strong candidates (may|might) also)\b/i;
const OTHER_HEAD = /^(responsibilities|what you('|’)ll do|the role|about (the role|us|the team|the company)|benefits|perks|compensation|our values|why join|how to apply|equal opportunity|location)\b/i;

/**
 * Structural heading rule: a short non-bullet line without terminal sentence
 * punctuation ("Minimum qualifications", "Logistics", "Annual Salary:").
 * Known phrases are recognised at any length up to 80 chars.
 */
const isHeading = (l: string) => {
  if (/^[-•*▪◦·]/.test(l)) return false;
  const head = l.replace(/[:\s]+$/, "");
  if (l.length <= 80 && (REQUIRED_HEAD.test(head) || PREFERRED_HEAD.test(head) || OTHER_HEAD.test(head))) return true;
  return l.length <= 60 && !/[.;!?,]$/.test(l);
};

export function extractRequirements(text: string): PostingRequirements {
  const out: PostingRequirements = { required: [], preferred: [] };
  let mode: "required" | "preferred" | null = null;
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    const head = l.replace(/[:\s]+$/, "");
    if (isHeading(l)) {
      mode = REQUIRED_HEAD.test(head) ? "required" : PREFERRED_HEAD.test(head) ? "preferred" : null;
      continue;
    }
    if (!mode) continue;
    const item = l.replace(/^[-•*▪◦·]\s*/, "").trim();
    if (item.length < 3 || item.length > 400) continue;
    // Inline "(preferred)" / "nice to have" markers move an item to preferred.
    const target = mode === "required" && /\b(preferred|nice to have|a plus|bonus)\b/i.test(item) ? "preferred" : mode;
    out[target].push(item);
  }
  out.required = [...new Set(out.required)].slice(0, 40);
  out.preferred = [...new Set(out.preferred)].slice(0, 40);
  return out;
}
