/**
 * Apply Demo access rules (edge-safe; used by the middleware and the route).
 *
 * The demo runs only synthetic test forms with fictional personas and stores
 * nothing, so it does not use the team's Supabase login. It is served only
 * when ALL of these hold:
 *  - APPLY_DEMO_ENABLED=1 and APPLY_DEMO_SECRET is set (personal Preview only);
 *  - the deployment is not production (VERCEL_ENV !== "production");
 *  - on Vercel, the deployment stays behind Vercel Deployment Protection.
 * The run API additionally requires a short-lived HMAC token that only the
 * demo page issues (see demo-token.ts).
 */
export const APPLY_DEMO_PATHS = [
  "/apply-demo",
  "/api/apply-demo/run",
  "/api/apply-demo/real/parse",
  "/api/apply-demo/real/review",
  "/api/apply-demo/real/submit",
] as const;

export function applyDemoEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.APPLY_DEMO_ENABLED !== "1") return false;
  if (env.VERCEL_ENV === "production") return false;
  if (!env.APPLY_DEMO_SECRET || env.APPLY_DEMO_SECRET.length < 32) return false;
  return true;
}

/** Exact paths only: no prefixes, so no other route can ride on the bypass. */
export function isApplyDemoPath(pathname: string): boolean {
  return (APPLY_DEMO_PATHS as readonly string[]).includes(pathname);
}
