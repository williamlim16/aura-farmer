/**
 * Job posting URL -> real application form URL (Greenhouse or Lever only).
 *
 * - Greenhouse/Lever URLs are validated by parsePostingUrl (strict slugs/ids)
 *   and mapped to their application page without fetching anything.
 * - Any other https page (a company careers page) is fetched once, server
 *   side, with SSRF controls: https only, public DNS only (checked on every
 *   hop), at most 3 redirects each re-validated, 2 MB cap, 10 s timeout. We
 *   only look for a Greenhouse/Lever application link in the HTML.
 */
import dns from "node:dns/promises";

import { parsePostingUrl } from "~/server/postings/url";
import { isPrivateAddress } from "~/server/postings/safe-fetch";

export type Ats = "greenhouse" | "lever";
export interface ResolvedApplication {
  ats: Ats;
  postingUrl: string;
  applyUrl: string;
  /** How the apply URL was found. */
  via: "direct" | "linked_from_page";
}

export class ResolveError extends Error {}

export function applyUrlFor(raw: string): ResolvedApplication | null {
  const p = parsePostingUrl(raw);
  if (!p.ok) return null;
  if (p.source === "greenhouse") {
    // The application form is on the job page itself (#app).
    return { ats: "greenhouse", postingUrl: p.canonical, applyUrl: p.canonical, via: "direct" };
  }
  if (p.source === "lever") return { ats: "lever", postingUrl: p.canonical, applyUrl: `${p.canonical}/apply`, via: "direct" };
  return null; // Ashby: not supported in this flow yet
}

export async function assertPublicHost(hostname: string): Promise<void> {
  if (/^\[|^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new ResolveError("That address is not allowed.");
  }
  const addrs = (await dns.lookup(hostname, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new ResolveError(`Could not resolve ${hostname}.`);
  if (addrs.some(isPrivateAddress)) throw new ResolveError("That address is not allowed.");
}

function checkUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new ResolveError("Enter a full https:// job posting URL.");
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) throw new ResolveError("Only plain https:// URLs are accepted.");
  return u;
}

const GH_JOB = /https:\/\/(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/[A-Za-z0-9_.-]+\/jobs\/\d+/g;
const GH_EMBED = /https:\/\/(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/embed\/job_app\?[^"'\s<>]+/g;
const LEVER = /https:\/\/jobs(?:\.eu)?\.lever\.co\/[A-Za-z0-9_.-]+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function fromEmbed(raw: string): ResolvedApplication | null {
  const u = new URL(raw.replace(/&amp;/g, "&"));
  const board = u.searchParams.get("for");
  const token = u.searchParams.get("token");
  if (!board || !token || !/^[A-Za-z0-9_.-]{1,100}$/.test(board) || !/^\d{1,20}$/.test(token)) return null;
  return applyUrlFor(`https://job-boards.greenhouse.io/${board}/jobs/${token}`);
}

async function fetchHtml(start: URL): Promise<{ html: string; finalUrl: URL }> {
  let url = start;
  for (let hop = 0; hop <= 3; hop++) {
    await assertPublicHost(url.hostname);
    const res = await fetch(url, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (compatible; AuraFarmerApply/0.1)", accept: "text/html" }, signal: AbortSignal.timeout(10_000) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new ResolveError("The page redirected without a location.");
      url = checkUrl(new URL(loc, url).toString());
      continue;
    }
    if (!res.ok) throw new ResolveError(`The posting page returned HTTP ${res.status}.`);
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 2 * 1024 * 1024) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    return { html: Buffer.concat(chunks).toString("utf8"), finalUrl: url };
  }
  throw new ResolveError("Too many redirects.");
}

export async function resolveApplication(raw: string): Promise<ResolvedApplication> {
  const u = checkUrl(raw);
  const direct = applyUrlFor(u.toString());
  if (direct) return direct;
  if (/\.(greenhouse\.io|lever\.co|ashbyhq\.com)$/.test(u.hostname)) {
    throw new ResolveError("Use a Greenhouse job link like https://job-boards.greenhouse.io/<company>/jobs/<id> or a Lever link like https://jobs.lever.co/<company>/<id>.");
  }
  const { html, finalUrl } = await fetchHtml(u);
  const redirected = applyUrlFor(finalUrl.toString());
  if (redirected) return { ...redirected, postingUrl: u.toString(), via: "linked_from_page" };
  const ghJid = u.searchParams.get("gh_jid");
  for (const m of html.match(GH_EMBED) ?? []) {
    const r = fromEmbed(m);
    if (r && (!ghJid || r.applyUrl.endsWith(`/jobs/${ghJid}`))) return { ...r, postingUrl: u.toString(), via: "linked_from_page" };
  }
  for (const re of [GH_JOB, LEVER]) {
    for (const m of html.match(re) ?? []) {
      const r = applyUrlFor(m);
      if (r && (!ghJid || r.applyUrl.endsWith(`/jobs/${ghJid}`) || r.ats === "lever")) return { ...r, postingUrl: u.toString(), via: "linked_from_page" };
    }
  }
  throw new ResolveError("No Greenhouse or Lever application form was found on that page. Paste the Greenhouse or Lever job link directly.");
}
