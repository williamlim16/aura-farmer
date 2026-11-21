/**
 * The Apply Demo stores nothing, but it is still behind the normal Supabase
 * login (team middleware + a session check in the route). It is additionally
 * off unless APPLY_DEMO_ENABLED=1, and never served on a production deployment.
 */
export function applyDemoEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.APPLY_DEMO_ENABLED !== "1") return false;
  if (env.VERCEL_ENV === "production") return false;
  return true;
}
