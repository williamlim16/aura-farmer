/** Deployment guards with no app-env imports (safe to unit test). */

/**
 * True when a hosted deployment is configured with a local auth URL (e.g. the
 * dev-only mock auth server). Such tokens are never accepted when hosted.
 */
export function isLocalAuthInHostedDeployment(env: NodeJS.ProcessEnv = process.env): boolean {
  const hosted = env.VERCEL === "1" || env.NODE_ENV === "production";
  if (!hosted || env.ALLOW_LOCAL_AUTH_IN_PRODUCTION_BUILD === "1") return false;
  try {
    const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
    return host === "localhost" || host.startsWith("127.") || host === "0.0.0.0" || host.endsWith(".local");
  } catch {
    return false;
  }
}

