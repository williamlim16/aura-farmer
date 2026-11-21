/** A job posting in the user's workspace. Pure types, shared by server and client. */
export type PostingSource = "greenhouse" | "lever" | "ashby" | "manual";

export interface PostingRequirements {
  /** Must-have requirements, one per line, as written in the posting. */
  required: string[];
  /** Nice-to-have / preferred. */
  preferred: string[];
}

export interface PostingDraft {
  source: PostingSource;
  sourceUrl: string | null;
  externalId: string | null;
  title: string;
  company: string;
  location: string;
  description: string;
  requirements: PostingRequirements;
  /** How the content was obtained: a live public API read, or typed/pasted by the user. */
  retrieval: "live_api" | "manual";
}
