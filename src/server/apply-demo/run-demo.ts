/**
 * Database-independent Apply Demo: one request = one browser run.
 *
 * Thin adapter around the existing engine (runApplication -> runAutofill:
 * form extraction, Rules -> Jev -> LLM -> safety decisions, fill, read-back
 * verification, three-layer submit guard). Nothing is persisted: the
 * candidate data, resume bytes and screenshot live only for this request.
 *
 * Targets:
 *  - synthetic: one of our test forms, served by the loopback form host that
 *    runs inside the same function (the browser cannot reach anything else);
 *  - ats: a public application page on an allow-listed ATS host. The egress
 *    allowlist limits the browser to that ATS's origins, and the submit guard
 *    aborts every non-GET request, so nothing can be submitted.
 */
import { findTarget } from "~/lib/applications/targets";
import { RuleProvider } from "~/lib/apply/decision/rules";
import type { DecisionProvider } from "~/lib/apply/decision/types";
import type { CandidateProfile } from "~/lib/profile/schema";
import type { ResumeKind } from "~/lib/resume/validate";
import { createJevProviders, createLlmProviders } from "~/server/llm/factory";
import { startFormHost } from "~/server/jobs/form-host";
import { runApplication } from "~/server/workflow/run-application";
import { launchDemoBrowser } from "./browser";

/** Public ATS application pages we allow, with the extra origins their pages load assets from. */
export const DEMO_ATS: Record<string, string[]> = {
  "job-boards.greenhouse.io": ["https://job-boards.greenhouse.io", "https://job-boards.cdn.greenhouse.io"],
  "boards.greenhouse.io": ["https://boards.greenhouse.io", "https://boards.cdn.greenhouse.io", "https://job-boards.greenhouse.io", "https://job-boards.cdn.greenhouse.io"],
  "jobs.lever.co": ["https://jobs.lever.co"],
  "jobs.ashbyhq.com": ["https://jobs.ashbyhq.com", "https://cdn.ashbyprd.com"],
};

export type DemoTarget = { kind: "synthetic"; key: string } | { kind: "ats"; url: string };

export function parseAtsUrl(raw: string): { ok: true; url: URL; origins: string[] } | { ok: false; error: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Enter a full https:// application URL." };
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return { ok: false, error: "Only plain https:// URLs are accepted." };
  const origins = DEMO_ATS[u.hostname];
  if (!origins) return { ok: false, error: `Supported application sites: ${Object.keys(DEMO_ATS).join(", ")}.` };
  return { ok: true, url: u, origins };
}

export interface DemoRunResult {
  target: { kind: DemoTarget["kind"]; url: string; title: string };
  runtime: { executor: string; chromiumVersion: string; region: string | null; durationMs: number; providers: string[] };
  report: Awaited<ReturnType<typeof runApplication>>["report"];
  blockedEgress: string[];
  screenshotPngBase64: string;
  events: string[];
}

function demoProviders(): { providers: DecisionProvider[]; notes: string[] } {
  const notes: string[] = [];
  const providers: DecisionProvider[] = [new RuleProvider()];
  for (const [name, make] of [["Jev", createJevProviders], ["LLM", createLlmProviders]] as const) {
    try {
      providers.push(...make(process.env));
    } catch (e) {
      notes.push(`${name} tier not enabled: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { providers, notes };
}

export async function runDemo(input: {
  target: DemoTarget;
  profile: CandidateProfile;
  resume: { bytes: Uint8Array; kind: ResumeKind; filename: string } | null;
  timeoutMs: number;
}): Promise<DemoRunResult> {
  const t0 = Date.now();
  const events: string[] = [];
  const { providers, notes } = demoProviders();
  events.push(...notes);

  let formUrl: string;
  let allowedOrigins: string[];
  let title: string;
  let host: Awaited<ReturnType<typeof startFormHost>> | null = null;
  if (input.target.kind === "synthetic") {
    const t = findTarget(input.target.key);
    if (!t) throw new DemoInputError("Unknown test form.");
    host = await startFormHost();
    formUrl = host.urlFor(t.file);
    allowedOrigins = [host.origin];
    title = `${t.title} — ${t.company}`;
  } else {
    const a = parseAtsUrl(input.target.url);
    if (!a.ok) throw new DemoInputError(a.error);
    formUrl = a.url.toString();
    allowedOrigins = a.origins;
    title = a.url.hostname + a.url.pathname;
  }

  const launched = await launchDemoBrowser();
  events.push(`Browser launched: Chromium ${launched.chromiumVersion} (${launched.runtime}) in ${Date.now() - t0} ms.`);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort("timeout"), input.timeoutMs);
  try {
    const result = await runApplication({
      formUrl,
      profile: input.profile,
      resume: input.resume,
      providers,
      allowedOrigins,
      browser: launched.browser,
      signal: ac.signal,
      onEvent: (level, m) => void events.push(`${level}: ${m}`),
    });
    if (host && host.submissions() > 0) events.push(`warn: ${host.submissions()} submission(s) reached the form host and were refused.`);
    return {
      target: { kind: input.target.kind, url: formUrl, title },
      runtime: {
        executor: launched.runtime,
        chromiumVersion: launched.chromiumVersion,
        region: process.env.VERCEL_REGION ?? null,
        durationMs: Date.now() - t0,
        providers: providers.map((p) => p.name),
      },
      report: result.report,
      blockedEgress: [...new Set(result.blockedEgress)].slice(0, 30),
      screenshotPngBase64: result.screenshotPng.toString("base64"),
      events,
    };
  } finally {
    clearTimeout(timer);
    await launched.browser.close().catch(() => undefined);
    await host?.close().catch(() => undefined);
  }
}

export class DemoInputError extends Error {}
