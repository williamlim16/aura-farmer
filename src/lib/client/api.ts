/**
 * Browser-side fetch wrapper for our JSON API. Handles the team middleware's
 * behaviour for expired sessions (it redirects API calls to /auth/login, so a
 * plain fetch receives the login page HTML), plus 401s and non-JSON errors.
 */
export const SESSION_EXPIRED = "Your session expired. Please sign in again.";

export type ApiOutcome<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string; code?: string; data: Record<string, unknown> };

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<ApiOutcome<T>> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    return { ok: false, status: 0, error: "Network error. Check your connection and try again.", data: {} };
  }
  if (res.status === 401 || (res.redirected && new URL(res.url).pathname.startsWith("/auth/login"))) {
    return { ok: false, status: 401, error: SESSION_EXPIRED, code: "unauthenticated", data: {} };
  }
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = (isJson ? await res.json().catch(() => ({})) : {}) as Record<string, unknown>;
  if (!res.ok) {
    return { ok: false, status: res.status, error: typeof data.error === "string" ? data.error : `Request failed (${res.status}).`, code: typeof data.code === "string" ? data.code : undefined, data };
  }
  return { ok: true, status: res.status, data: data as T };
}
