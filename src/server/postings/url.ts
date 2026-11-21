/**
 * Job posting URL parsing against a strict allowlist. We never fetch the
 * user's URL: we extract a board slug and job id (validated) and call a fixed
 * official read-only API host. Anything else is "unsupported" and the user can
 * paste the description manually.
 */
export type ParsedPostingUrl =
  | { ok: true; source: "greenhouse"; board: string; jobId: string; canonical: string }
  | { ok: true; source: "lever"; site: string; postingId: string; region: "global" | "eu"; canonical: string }
  | { ok: true; source: "ashby"; board: string; postingId: string; canonical: string }
  | { ok: false; reason: string };

const SLUG = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC = /^\d{1,20}$/;

export function parsePostingUrl(raw: string): ParsedPostingUrl {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "Enter a full https:// link to the job posting." };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "Only https:// links are supported." };
  if (u.username || u.password || (u.port && u.port !== "443")) return { ok: false, reason: "That link format is not supported." };
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io" || host === "job-boards.eu.greenhouse.io") {
    // /{board}/jobs/{id}
    const [board, kw, jobId] = parts;
    if (board && kw === "jobs" && jobId && SLUG.test(board) && NUMERIC.test(jobId)) {
      return { ok: true, source: "greenhouse", board, jobId, canonical: `https://${host}/${board}/jobs/${jobId}` };
    }
    return { ok: false, reason: "Greenhouse links should look like https://boards.greenhouse.io/<company>/jobs/<number>." };
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    // /{site}/{uuid}(/apply)?
    const [site, postingId] = parts;
    if (site && postingId && SLUG.test(site) && UUID.test(postingId)) {
      return { ok: true, source: "lever", site, postingId, region: host.includes(".eu.") ? "eu" : "global", canonical: `https://${host}/${site}/${postingId}` };
    }
    return { ok: false, reason: "Lever links should look like https://jobs.lever.co/<company>/<posting-id>." };
  }
  if (host === "jobs.ashbyhq.com") {
    // /{board}/{uuid}(/application)?
    const [board, postingId] = parts;
    if (board && postingId && SLUG.test(decodeURIComponent(board)) && UUID.test(postingId)) {
      return { ok: true, source: "ashby", board: decodeURIComponent(board), postingId, canonical: `https://jobs.ashbyhq.com/${encodeURIComponent(decodeURIComponent(board))}/${postingId}` };
    }
    return { ok: false, reason: "Ashby links should look like https://jobs.ashbyhq.com/<company>/<posting-id>." };
  }
  return { ok: false, reason: `${host} is not supported yet (Greenhouse, Lever and Ashby are). Paste the job description instead.` };
}
