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

export interface FitPoint extends Evidence {
  point: string;
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
  /** 1–5: how well the *sourced* facts match the stated preferences. */
  fitScore: number;
  verdict: string;
  matches: FitPoint[];
  concerns: FitPoint[];
  /** Preferences the sources say nothing about. Not claims, so no source. */
  unknowns: string[];
  facts: Fact[];
  openRoles: OpenRole[];
  sources: Source[];
}

export interface CompanyResearchResult {
  companies: CompanyResult[];
  /** Companies considered but dropped (no verifiable evidence, errors). */
  skipped: { name: string; reason: string }[];
  /** Claims removed because their quote wasn't found on the cited page. */
  droppedClaims: number;
  generatedAt: string;
}
