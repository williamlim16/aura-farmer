/**
 * Database-independent Apply Demo: one request = one browser run.
 *
 * Thin adapter around the existing engine (runApplication -> runAutofill:
 * form extraction, Rules -> Jev -> LLM -> safety decisions, fill, read-back
 * verification, three-layer submit guard). Nothing is persisted: the
 * candidate data, resume bytes and screenshot live only for this request.
 *
 * Targets: only our allow-listed synthetic test forms, served by the loopback
 * form host inside the same function. The browser's egress allowlist is that
 * one loopback origin, so it cannot reach the internet or any real site.
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

export interface DemoRunResult {
  target: { key: string; url: string; title: string };
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
  formKey: string;
  profile: CandidateProfile;
  resume: { bytes: Uint8Array; kind: ResumeKind; filename: string } | null;
  timeoutMs: number;
}): Promise<DemoRunResult> {
  const t0 = Date.now();
  const events: string[] = [];
  const { providers, notes } = demoProviders();
  events.push(...notes);

  const t = findTarget(input.formKey);
  if (!t || t.key === "trap") throw new DemoInputError("Unknown test form.");
  const host = await startFormHost();
  const formUrl = host.urlFor(t.file);
  const allowedOrigins = [host.origin];
  const title = `${t.title} — ${t.company}`;

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
    if (host.submissions() > 0) events.push(`warn: ${host.submissions()} submission(s) reached the form host and were refused.`);
    return {
      target: { key: t.key, url: formUrl, title },
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
    await host.close().catch(() => undefined);
  }
}

export class DemoInputError extends Error {}
