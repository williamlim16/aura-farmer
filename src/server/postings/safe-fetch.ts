/**
 * Outbound fetch for public job-board APIs only.
 * - Host must be on a fixed allowlist of official API hosts.
 * - Every resolved address is checked against private/loopback/link-local
 *   ranges (adapted from career-ops providers/_ip-guard.mjs, MIT).
 * - Redirects are refused, there is a timeout and a response size cap,
 *   GET only, no credentials.
 */
import dns from "node:dns/promises";
import net from "node:net";

export const API_HOSTS = new Set(["boards-api.greenhouse.io", "api.lever.co", "api.eu.lever.co", "api.ashbyhq.com"]);

export class FetchBlockedError extends Error {
  constructor(message: string, readonly code: "host_not_allowed" | "private_address" | "redirect" | "too_large" | "timeout" | "http_error" | "network", readonly status?: number) {
    super(message);
    this.name = "FetchBlockedError";
  }
}

export function isPrivateAddress(addr: string): boolean {
  if (net.isIPv4(addr)) {
    const [a, b] = addr.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(addr)) {
    const x = addr.toLowerCase();
    if (x === "::1" || x === "::") return true;
    if (x.startsWith("::ffff:")) return isPrivateAddress(x.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x);
  }
  return true;
}

export interface SafeFetchOptions {
  fetchImpl?: typeof fetch;
  lookup?: (host: string) => Promise<string[]>;
  timeoutMs?: number;
  maxBytes?: number;
}

export async function safeFetchJson(url: string, o: SafeFetchOptions = {}): Promise<unknown> {
  const u = new URL(url);
  if (u.protocol !== "https:" || !API_HOSTS.has(u.hostname)) throw new FetchBlockedError(`Host ${u.hostname} is not allowed.`, "host_not_allowed");
  const addrs = await (o.lookup ?? (async (h) => (await dns.lookup(h, { all: true })).map((a) => a.address)))(u.hostname).catch(() => {
    throw new FetchBlockedError("Could not resolve the job board.", "network");
  });
  if (!addrs.length || addrs.some(isPrivateAddress)) throw new FetchBlockedError("The job board resolved to a private address.", "private_address");

  let res: Response;
  try {
    res = await (o.fetchImpl ?? fetch)(u.toString(), {
      method: "GET",
      redirect: "error",
      credentials: "omit",
      headers: { accept: "application/json", "user-agent": "aura-farmer-job-intake/0.1" },
      signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
    });
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") throw new FetchBlockedError("The job board took too long to respond.", "timeout");
    throw new FetchBlockedError("The job board could not be reached (or tried to redirect).", "redirect");
  }
  if (res.status >= 300 && res.status < 400) throw new FetchBlockedError("Redirects are not followed.", "redirect");
  if (!res.ok) throw new FetchBlockedError(res.status === 404 ? "That job posting was not found. It may have closed." : `The job board returned HTTP ${res.status}.`, "http_error", res.status);

  const max = o.maxBytes ?? 8 * 1024 * 1024;
  if (Number(res.headers.get("content-length") ?? 0) > max) throw new FetchBlockedError("The job board response is too large.", "too_large");
  const reader = res.body?.getReader();
  if (!reader) return res.json();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new FetchBlockedError("The job board response is too large.", "too_large");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
