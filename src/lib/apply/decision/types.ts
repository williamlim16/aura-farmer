import type { CandidateProfile } from "~/lib/profile/schema";
import type { Classification, Decision, DecisionTier, FormField } from "../types";

export interface DecisionInput {
  field: FormField;
  classification: Classification;
}

export interface DecisionContext {
  profile: CandidateProfile;
  /** Short job context (title/company) for essay drafting. Untrusted page data. */
  job?: { title?: string; company?: string; description?: string };
  hasResume: boolean;
}

export interface ProviderUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Measured from provider-reported usage and a configured price table; 0 if unknown. */
  costUsd: number;
  /** true if token counts came from real provider metadata; false = mock/estimate. */
  measured?: boolean;
}

/**
 * A decision tier. Providers receive every still-undecided field at once, so
 * an LLM provider can answer them in one call. Returning no entry for a field
 * means "abstain" and passes it to the next tier.
 */
export interface DecisionProvider {
  readonly tier: DecisionTier;
  readonly name: string;
  decideMany(inputs: DecisionInput[], ctx: DecisionContext): Promise<Map<string, Decision>>;
  usage?(): ProviderUsage;
}
