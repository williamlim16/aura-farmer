/**
 * Signed review state. Serverless functions keep no browser between "review"
 * and "submit", so the review run returns a token binding exactly what the
 * user reviewed: the apply URL, the resume bytes (SHA-256), the profile and
 * answers (SHA-256) and every field's read-back value. The submit run must be
 * given the same inputs, re-fills the form, and must reproduce the same
 * verified values before it may click submit. HMAC-SHA256 with
 * APPLY_DEMO_SECRET; 30-minute expiry.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface ReviewedField {
  step: number;
  label: string;
  outcome: string;
  value: string;
  required: boolean;
}

export interface ReviewState {
  v: 1;
  applyUrl: string;
  resumeSha: string;
  profileSha: string;
  fields: ReviewedField[];
  exp: number;
}

const TTL_MS = 30 * 60 * 1000;

export const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(`apply-review:${payload}`).digest("base64url");

export function issueReviewToken(state: Omit<ReviewState, "v" | "exp">, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, ...state, exp: now + TTL_MS } satisfies ReviewState)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function readReviewToken(token: unknown, secret: string, now = Date.now()): ReviewState | null {
  if (typeof token !== "string" || token.length > 64_000) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ReviewState;
    return s.v === 1 && s.exp >= now ? s : null;
  } catch {
    return null;
  }
}

/** Stable digest of the reviewed field values, for comparison in the submit run. */
export function fieldKey(f: { step: number; label: string }) {
  return `${f.step}|${f.label.trim().toLowerCase()}`;
}
