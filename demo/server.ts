/**
 * Local end-to-end demo: upload -> parse -> review profile -> pick a local test
 * form -> Decision Engine + Playwright autofill -> application review.
 *
 *   pnpm demo            # http://127.0.0.1:4317
 *
 * Isolation (by design, not configuration):
 *  - Not part of the Next.js app or build; never deployed.
 *  - Binds 127.0.0.1 only; rejects foreign Host headers (DNS rebinding) and
 *    cross-origin state-changing requests.
 *  - MemoryStorage + in-process state only; nothing persisted, no Supabase,
 *    no env secrets read. Refuses to start when NODE_ENV=production.
 *  - The browser may only reach this server's own origin (egress allowlist);
 *    forms come from a fixed allowlist of synthetic fixtures.
 *  - Never submits: submit guard + no submit code path. Any POST that reaches
 *    the fixture endpoint is counted and shown (expected: 0).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import type { AddressInfo } from "node:net";

import { chromium, type Browser, type BrowserContext } from "playwright";

import { LlmProvider } from "~/lib/apply/decision/llm";
import { RuleProvider } from "~/lib/apply/decision/rules";
import type { DecisionProvider } from "~/lib/apply/decision/types";
import { applyReview, toReview, type ReviewInput } from "~/lib/profile/review";
import type { CandidateProfile } from "~/lib/profile/schema";
import type { ResumeKind } from "~/lib/resume/validate";
import { MemoryStorage } from "~/server/storage/memory";
import { ingestResume } from "~/server/workflow/ingest";
import { runApplication } from "~/server/workflow/run-application";
import { makeDocx, makePdf } from "../tests/helpers/resume-fixtures";
import { demoMockLlm } from "./mock-llm";

const DEMO_USER = "demo-user"; // synthetic, single local user
const PUBLIC_DIR = path.resolve(import.meta.dirname, "public");
const FORM_DIRS = [path.resolve(import.meta.dirname, "../test-forms")];

export const DEMO_FORMS: { file: string; title: string; description: string }[] = [
  { file: "full-application.html", title: "Full application (Example Corp)", description: "Realistic single-page application: contact, links, resume, work rights, salary, EEO, essay, consent." },
  { file: "basic.html", title: "Basic form", description: "Well-labelled fields with autocomplete hints. Rules should fill everything." },
  { file: "ambiguous.html", title: "Ambiguous labels", description: "Placeholder-only and nearby-text labels, similar options, sensitive and AI-directed questions, honeypot." },
  { file: "dynamic.html", title: "Dynamic form", description: "A field that appears after a delay and a conditional referral section." },
  { file: "trap.html", title: "Submit traps", description: "A hostile page that tries to auto-submit three ways. Every attempt must be blocked." },
];

const MAX_BODY = 6 * 1024 * 1024;

interface DemoState {
  storage: MemoryStorage;
  resume: { path: string; kind: ResumeKind; filename: string } | null;
  parsedProfile: CandidateProfile | null;
  profile: CandidateProfile | null;
  missing: string[];
  submissionsReceived: { url: string; at: string }[];
  headedContext: BrowserContext | null;
  headedBrowser: Browser | null;
  running: boolean;
}

export function createDemoState(): DemoState {
  return { storage: new MemoryStorage(), resume: null, parsedProfile: null, profile: null, missing: [], submissionsReceived: [], headedContext: null, headedBrowser: null, running: false };
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 256 * 1024) throw new HttpError(413, "Request too large.");
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}

function toWebRequest(req: http.IncomingMessage, origin: string): Request {
  const len = Number(req.headers["content-length"] ?? 0);
  if (len > MAX_BODY) throw new HttpError(413, "File too large.");
  let seen = 0;
  const limited = Readable.from(
    (async function* () {
      for await (const c of req) {
        seen += (c as Buffer).length;
        if (seen > MAX_BODY) throw new HttpError(413, "File too large.");
        yield c as Buffer;
      }
    })(),
  );
  return new Request(new URL(req.url ?? "/", origin), {
    method: req.method,
    headers: { "content-type": String(req.headers["content-type"] ?? "") },
    body: Readable.toWeb(limited) as ReadableStream,
    duplex: "half",
  } as RequestInit);
}

function findForm(file: string): string | null {
  if (!DEMO_FORMS.some((f) => f.file === file)) return null;
  for (const dir of FORM_DIRS) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const CONTENT_TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

export function createDemoServer(opts: { state?: DemoState; browser?: Browser } = {}) {
  const state = opts.state ?? createDemoState();
  let sharedBrowser: Browser | null = opts.browser ?? null;
  let origin = "";
  let allowedHosts = new Set<string>();

  async function headlessBrowser() {
    sharedBrowser ??= await chromium.launch({ headless: true });
    return sharedBrowser;
  }

  async function closeHeaded() {
    await state.headedContext?.close().catch(() => undefined);
    await state.headedBrowser?.close().catch(() => undefined);
    state.headedContext = null;
    state.headedBrowser = null;
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    // DNS-rebinding / cross-site protection.
    if (!allowedHosts.has(String(req.headers.host ?? ""))) throw new HttpError(421, "Unknown host.");
    const url = new URL(req.url ?? "/", origin);
    const method = req.method ?? "GET";

    // The fixture forms post to /submit. Reaching here means a submission escaped the guard.
    if (url.pathname === "/submit") {
      state.submissionsReceived.push({ url: url.pathname, at: new Date().toISOString() });
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("Recorded by demo (should never happen).");
    }

    if (method !== "GET" && method !== "HEAD") {
      const o = String(req.headers.origin ?? "");
      if (!o || !allowedHosts.has(o.replace(/^https?:\/\//, ""))) throw new HttpError(403, "Cross-origin request refused.");
    }

    if (method === "GET" && url.pathname.startsWith("/forms/")) {
      const p = findForm(path.basename(url.pathname));
      if (!p) throw new HttpError(404, "Unknown form.");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(fs.readFileSync(p));
    }

    if (url.pathname === "/api/state" && method === "GET") {
      return json(res, 200, {
        resume: state.resume,
        missing: state.missing,
        review: state.profile ? toReview(state.profile) : null,
        forms: DEMO_FORMS,
        submissionsReceived: state.submissionsReceived.length,
      });
    }

    if (url.pathname.startsWith("/api/sample-resume.") && method === "GET") {
      const kind = url.pathname.endsWith(".docx") ? "docx" : "pdf";
      const bytes = kind === "pdf" ? await makePdf() : await makeDocx();
      res.writeHead(200, {
        "content-type": kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename="synthetic-resume-avery-quinn.${kind}"`,
      });
      return res.end(Buffer.from(bytes));
    }

    if (url.pathname === "/api/upload" && method === "POST") {
      const form = await toWebRequest(req, origin).formData().catch((e: unknown) => {
        if (e instanceof HttpError) throw e;
        throw new HttpError(400, "Expected multipart form data.");
      });
      const result = await ingestResume({ userId: DEMO_USER, file: form.get("resume"), storage: state.storage });
      if (!result.ok) return json(res, result.status, { error: result.error, code: result.code });
      if (state.resume) await state.storage.delete(state.resume.path); // one resume at a time
      state.resume = result.resume;
      state.parsedProfile = result.profile;
      state.profile = result.profile;
      state.missing = result.missing;
      return json(res, 201, { resume: result.resume, missing: result.missing, textChars: result.textChars, review: toReview(result.profile) });
    }

    if (url.pathname === "/api/profile" && method === "PUT") {
      if (!state.profile) throw new HttpError(409, "Upload a resume first.");
      const result = applyReview(state.profile, (await readJson(req)) as ReviewInput);
      if (!result.ok) return json(res, 422, { errors: result.errors });
      state.profile = result.profile;
      return json(res, 200, { review: toReview(result.profile) });
    }

    if (url.pathname === "/api/run" && method === "POST") {
      if (!state.profile) throw new HttpError(409, "Upload and review a resume first.");
      if (state.running) throw new HttpError(409, "A run is already in progress.");
      const body = (await readJson(req)) as { form?: string; llm?: string; headed?: boolean };
      const form = DEMO_FORMS.find((f) => f.file === body.form);
      if (!form || !findForm(form.file)) throw new HttpError(400, "Choose one of the listed test forms.");
      const providers: DecisionProvider[] = [new RuleProvider()];
      if (body.llm === "mock") providers.push(new LlmProvider(demoMockLlm(), { maxCallsPerRun: 2 }));

      state.running = true;
      const before = state.submissionsReceived.length;
      try {
        await closeHeaded();
        const resumeBytes = state.resume ? await state.storage.get(state.resume.path) : null;
        const headed = body.headed === true;
        const browser = headed ? await chromium.launch({ headless: false, slowMo: 60 }) : await headlessBrowser();
        const t0 = performance.now();
        const result = await runApplication({
          formUrl: `${origin}/forms/${form.file}`,
          profile: state.profile,
          resume: state.resume && resumeBytes ? { bytes: resumeBytes, kind: state.resume.kind, filename: state.resume.filename } : null,
          providers,
          allowedOrigins: [origin],
          job: { title: "Software Engineer", company: "Example Corp" },
          browser,
          keepOpen: headed,
        });
        if (headed) {
          state.headedBrowser = browser;
          state.headedContext = result.context ?? null;
        }
        return json(res, 200, {
          form,
          llm: body.llm === "mock" ? "mock (scripted, no API calls)" : "none",
          report: result.report,
          wallMs: Math.round(performance.now() - t0),
          screenshot: `data:image/png;base64,${result.screenshotPng.toString("base64")}`,
          blockedEgress: result.blockedEgress,
          submissionsReceived: state.submissionsReceived.length - before,
          headedWindowOpen: headed,
        });
      } finally {
        state.running = false;
      }
    }

    if (url.pathname === "/api/reset" && method === "POST") {
      await closeHeaded();
      if (state.resume) await state.storage.delete(state.resume.path);
      Object.assign(state, { resume: null, parsedProfile: null, profile: null, missing: [] });
      return json(res, 200, { ok: true });
    }

    if (method === "GET") {
      const file = url.pathname === "/" ? "index.html" : path.basename(url.pathname);
      const p = path.join(PUBLIC_DIR, file);
      if (CONTENT_TYPES[path.extname(file)] && fs.existsSync(p)) {
        res.writeHead(200, {
          "content-type": CONTENT_TYPES[path.extname(file)]!,
          "cache-control": "no-store",
          "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff",
        });
        return res.end(fs.readFileSync(p));
      }
    }
    throw new HttpError(404, "Not found.");
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error("[demo]", err);
      if (!res.headersSent) json(res, status, { error: err instanceof HttpError ? err.message : "Internal error." });
      else res.end();
    });
  });

  return {
    state,
    async listen(port = 0) {
      await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
      const p = (server.address() as AddressInfo).port;
      origin = `http://127.0.0.1:${p}`;
      allowedHosts = new Set([`127.0.0.1:${p}`, `localhost:${p}`]);
      return origin;
    },
    async close() {
      await closeHeaded();
      if (sharedBrowser && !opts.browser) await sharedBrowser.close().catch(() => undefined);
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

// CLI entry
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  if (process.env.NODE_ENV === "production") {
    console.error("The demo server refuses to run with NODE_ENV=production.");
    process.exit(1);
  }
  const demo = createDemoServer();
  const port = Number(process.env.DEMO_PORT ?? 4317);
  void demo.listen(port).then((o) => {
    console.log(`\nAura Farmer local demo: ${o}\n(synthetic data, in-memory storage, never submits; Ctrl+C to stop)\n`);
  });
  const stop = () => void demo.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
