import "server-only";

import { NextResponse } from "next/server";

import { createClient } from "~/lib/supabase/server";
import { getQueue } from "~/server/jobs";
import { getRepos } from "~/server/repos";
import { getStorage } from "~/server/storage";
import type { ApiDeps, ApiResult } from "./handlers";
import { isLocalAuthInHostedDeployment } from "./hosting";

export { isLocalAuthInHostedDeployment } from "./hosting";

/** Supabase user id from the session cookie (verified by getClaims), or null. */
export async function currentUserId(): Promise<string | null> {
  if (isLocalAuthInHostedDeployment()) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return typeof sub === "string" && sub.length > 0 ? sub : null;
}

export async function apiDeps(): Promise<ApiDeps> {
  const [repos, queue] = await Promise.all([getRepos(), getQueue()]);
  return { repos, queue, storage: getStorage() };
}

export function respond(result: ApiResult) {
  return NextResponse.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}

export function errorResponse(status: number, error: string, code: string) {
  return respond({ status, body: { error, code } });
}

/**
 * CSRF defence for cookie-authenticated mutations: when the browser sends an
 * Origin header it must match this host. (Supabase cookies are SameSite=Lax as
 * a second layer.)
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser clients; still require a valid session
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const MAX_JSON = 64 * 1024;

/** Parse a JSON body with a size cap and a required JSON content type. */
export async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; status: number; error: string }> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return { ok: false, status: 415, error: "Expected application/json." };
  }
  const text = await request.text();
  if (text.length > MAX_JSON) return { ok: false, status: 413, error: "Request too large." };
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON." };
  }
}

/** Wrap a route so unexpected errors become a generic 500 without leaking internals. */
export function guarded<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      console.error("[api]", e instanceof Error ? e.message : e);
      return errorResponse(500, "Something went wrong.", "internal");
    }
  };
}
