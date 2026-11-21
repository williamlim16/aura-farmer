/**
 * Shapes stored in `company_search.result`. Pure types/constants (no server
 * imports) so UI components can use them.
 *
 * Every claim carries the source it came from and a verbatim quote from that
 * page; the pipeline drops any claim whose quote isn't actually on the page.
 */

export type SourceKind =
  | "Company site"
  | "LinkedIn"
  | "Glassdoor"
  | "Job board"
  | "News"
  | "Reference"
  | "Web";

export interface Source {
  url: string;
  title: string;
  domain: string;
  kind: SourceKind;
}

/** A sourced, quote-verified statement. */
export interface Evidence {
  /** Index into `CompanyResult.sources`. */
  source: number;
  quote: string;
}

export const FACT_CATEGORIES = [
  "location",
  "industry",
  "size",
  "culture",
  "work_arrangement",
  "employment_types",
  "other",
] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

export const FACT_CATEGORY_LABELS: Record<FactCategory, string> = {
  location: "Location",
  industry: "Industry",
  size: "Size & stage",
  culture: "Culture & structure",
  work_arrangement: "Work arrangement",
  employment_types: "Employment types",
  other: "Other",
};

export interface Fact extends Evidence {
  category: FactCategory;
  statement: string;
}

export type RequirementStatus = "met" | "not_met" | "unknown";

/** How one of the candidate's requirements fares at one company. */
export interface RequirementCheck {
  /** Index into `CompanyResearchResult.requirements`. */
  requirement: number;
  /**
   * "met" / "not_met" only when backed by a verified quote; anything the
   * sources don't settle (or whose quote failed the check) is "unknown".
   */
  status: RequirementStatus;
  /** What the source shows, e.g. "About 150 employees". Null when unknown. */
  finding: string | null;
  evidence: Evidence | null;
}

export interface OpenRole extends Evidence {
  title: string;
  /** Posting URL: the source page itself, or a link verbatim on that page. */
  url: string;
  location: string | null;
  workArrangement: string | null;
  employmentType: string | null;
}

export interface CompanyResult {
  name: string;
  /** Official site, only if it was one of the sources. */
  website: string | null;
  verdict: string;
  /** One per requirement, in the same order. Fit = how many are "met". */
  checks: RequirementCheck[];
  facts: Fact[];
  openRoles: OpenRole[];
  sources: Source[];
}

export interface FitSummary {
  met: number;
  notMet: number;
  unknown: number;
  total: number;
}

/** Fit is a count, not a judgement: requirements met out of those stated. */
export function fitSummary(company: CompanyResult): FitSummary {
  const count = (s: RequirementStatus) =>
    company.checks.filter((c) => c.status === s).length;
  return {
    met: count("met"),
    notMet: count("not_met"),
    unknown: count("unknown"),
    total: company.checks.length,
  };
}

export interface CompanyResearchResult {
  /** The candidate's preferences split into separate, checkable requirements. */
  requirements: string[];
  companies: CompanyResult[];
  /** Companies considered but dropped (no verifiable evidence, errors). */
  skipped: { name: string; reason: string }[];
  /** Claims removed because their quote wasn't found on the cited page. */
  droppedClaims: number;
  generatedAt: string;
}
