/**
 * Short-lived run token: issued when the demo page renders (which is behind
 * Vercel Deployment Protection), required by the run API. HMAC-SHA256 over
 * the expiry with APPLY_DEMO_SECRET; constant-time comparison.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_MS = 30 * 60 * 1000;

function sign(exp: number, secret: string) {
  return createHmac("sha256", secret).update(`apply-demo:${exp}`).digest("base64url");
}

export function issueDemoToken(secret: string, now = Date.now()): string {
  const exp = now + TTL_MS;
  return `${exp}.${sign(exp, secret)}`;
}

export function verifyDemoToken(token: unknown, secret: string, now = Date.now()): boolean {
  if (typeof token !== "string") return false;
  const m = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp < now || exp > now + TTL_MS + 60_000) return false;
  const a = Buffer.from(m[2]!);
  const b = Buffer.from(sign(exp, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}
