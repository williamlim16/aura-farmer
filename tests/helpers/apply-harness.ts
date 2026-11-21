/**
 * Local harness: a static server for the fixture forms that RECORDS any POST
 * that reaches it (so tests can prove nothing was submitted), plus a
 * synthetic applicant profile.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { chromium, type Browser } from "playwright";

import { parseResumeText } from "~/lib/resume/parse-profile";
import type { CandidateProfile } from "~/lib/profile/schema";
import { DecisionEngine } from "~/lib/apply/decision/engine";
import { RuleProvider } from "~/lib/apply/decision/rules";
import type { DecisionProvider } from "~/lib/apply/decision/types";
import { installSubmitGuard } from "~/server/apply/submit-guard";
import { runAutofill } from "~/server/apply/run";
import { SAMPLE_RESUME_LINES, makePdf } from "./resume-fixtures";

export const FORMS_DIR = path.resolve(import.meta.dirname, "../../test-forms");

export interface FixtureServer {
  url: string;
  posts: { url: string; body: string }[];
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const posts: FixtureServer["posts"] = [];
  const server = http.createServer((req, res) => {
    if (req.method !== "GET") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        posts.push({ url: req.url ?? "", body });
        res.end("submitted");
      });
      return;
    }
    const name = path.basename(req.url?.split("?")[0] ?? "");
    const file = path.join(FORMS_DIR, name);
    if (!name.endsWith(".html") || !fs.existsSync(file)) {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(fs.readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, posts, close: () => new Promise((r) => server.close(() => r())) };
}

/** Synthetic applicant: parsed from the sample resume, plus user-stated preferences. */
export function syntheticProfile(): CandidateProfile {
  const { profile } = parseResumeText(SAMPLE_RESUME_LINES.join("\n"), new Date("2026-11-21"));
  profile.preferences = {
    workAuthorization: { Australia: true },
    needsSponsorship: false,
    salaryExpectation: "150000",
    referralSource: "LinkedIn",
  };
  return profile;
}

export async function writeResumeFile(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "af-resume-"));
  const p = path.join(dir, "avery-quinn-resume.pdf");
  fs.writeFileSync(p, await makePdf());
  return p;
}

export async function launch(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

export async function autofillFixture(
  browser: Browser,
  server: FixtureServer,
  form: string,
  opts: { providers?: DecisionProvider[]; profile?: CandidateProfile; resumePath?: string | null } = {},
) {
  const context = await browser.newContext();
  const guard = await installSubmitGuard(context);
  const page = await context.newPage();
  await page.goto(`${server.url}/${form}`);
  const engine = new DecisionEngine(opts.providers ?? [new RuleProvider()]);
  const report = await runAutofill(page, engine, { profile: opts.profile ?? syntheticProfile(), hasResume: opts.resumePath !== null, job: { title: "Software Engineer", company: "Example Corp" } }, {
    resumePath: opts.resumePath ?? null,
    guard,
  });
  return { report, page, context };
}
