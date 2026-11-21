/** Request guards for the Apply with AI route: same-origin and one browser run at a time. */

/**
 * CSRF defence for cookie-authenticated mutations: when the browser sends an
 * Origin header it must match this host.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser clients still need a valid session
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const g = globalThis as unknown as { __afApplyBusy?: boolean; __afApplyLast?: Map<string, number> };
const MIN_GAP_MS = 15_000;

/** One browser run per function instance, and at most one run per user every 15 s. */
export async function exclusive<T>(userId: string, fn: () => Promise<T>): Promise<T | "busy" | "too_soon"> {
  const last = (g.__afApplyLast ??= new Map());
  if (g.__afApplyBusy) return "busy";
  if (Date.now() - (last.get(userId) ?? 0) < MIN_GAP_MS) return "too_soon";
  g.__afApplyBusy = true;
  last.set(userId, Date.now());
  try {
    return await fn();
  } finally {
    g.__afApplyBusy = false;
  }
}
