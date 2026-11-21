/**
 * Full end-to-end journey through the RUNNING application, driven like a user.
 *
 *   npx tsx scripts/e2e/full-journey.ts            # artifacts in e2e-artifacts/<timestamp>/
 *
 * LOCAL REAL: Next.js app (production build + next start), Postgres (PGlite over the wire), file storage,
 * browser worker, Playwright. MOCK: Supabase Auth (local JWKS stand-in, not
 * real Supabase), LLM tier (scripted). LIVE: one read-only job-posting fetch
 * from a public Greenhouse board (no application endpoint is ever called).
 * The test submission goes to an isolated local receiver that records it and
 * cannot forward anything.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { chromium, type BrowserContext, type Page } from "playwright";

import { buildFillPlan } from "~/lib/applications/fill-plan";
import { startFormHost } from "~/server/jobs/form-host";
import { createWorkerRuntime } from "~/server/jobs/runtime";
import { BrowserWorker } from "~/server/jobs/worker";
import { createLlmProviders } from "~/server/llm/factory";
import { safeFetchJson } from "~/server/postings/safe-fetch";
import { extractResumeText } from "~/server/resume/extract-text";
import { startDevDb } from "../dev/db";
import { startMockAuth, SYNTHETIC_USERS } from "../dev/mock-auth";
import { stackEnv } from "../dev/stack";
import { makeRealisticResumePdf, MORGAN } from "../../tests/helpers/realistic-resume";

type Status = "PASS" | "FAIL" | "PARTIAL" | "BLOCKED";
const stages: { stage: string; status: Status; result: string; evidence: string[]; mode: string }[] = [];
const out = path.resolve("e2e-artifacts", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: true });
const record = (stage: string, status: Status, result: string, evidence: string[], mode: string) => {
  stages.push({ stage, status, result, evidence, mode });
  console.log(`[${status}] ${stage}: ${result}`);
};
const freePort = () => new Promise<number>((r) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });
// caret: "initial" avoids Playwright injecting a caret-hiding style during hydration (false hydration warnings).
const shot = async (page: Page, name: string) => { const f = path.join(out, `${name}.png`); await page.waitForLoadState("networkidle").catch(() => undefined); await page.screenshot({ path: f, fullPage: true, caret: "initial" }); return path.relative(process.cwd(), f); };

const consoleErrors: string[] = [];
const failedRequests: string[] = [];
function watch(page: Page, who: string) {
  page.on("console", (m) => {
    if (m.type() !== "error" || (who === "userB" && m.text().includes("404"))) return;
    void Promise.all(m.args().map((a) => a.jsonValue().catch(() => ""))).then((args) => consoleErrors.push(`${who} @ ${new URL(page.url()).pathname}: ${args.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ").slice(0, 3000)}`));
  });
  page.on("response", (r) => { if (r.status() >= 500 || (r.status() >= 400 && r.url().includes("/api/") && ![401, 404, 409, 422, 429].includes(r.status()))) failedRequests.push(`${who}: ${r.status()} ${r.url()}`); });
}

async function main() {
  const resumeBytes = await makeRealisticResumePdf();
  fs.writeFileSync(path.join(out, "morgan-lee-resume.pdf"), resumeBytes);
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "af-e2e-"));
  const [dbPort, appPort, authPort] = await Promise.all([freePort(), freePort(), freePort()]);
  const appUrl = `http://localhost:${appPort}`;
  const db = await startDevDb({ dir: "memory://", port: dbPort });
  const auth = await startMockAuth({ appUrl, port: authPort });
  const env = stackEnv({ databaseUrl: db.url, authUrl: auth.url, storageDir, llm: "mock" });
  // Production build + server (deterministic; next dev has intermittent route-compile races).
  // NODE_ENV=production for the build only; the server keeps the stack's development env so the
  // dev-only drivers (file storage, local repos) and mock auth are allowed.
  let nextLog = "";
  if (!process.argv.includes("--skip-build")) {
    console.log("Building the app (next build)...");
    const b = spawn(path.resolve("node_modules/.bin/next"), ["build"], { env: { ...env, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
    b.stdout.on("data", (d: Buffer) => (nextLog += d.toString()));
    b.stderr.on("data", (d: Buffer) => (nextLog += d.toString()));
    const code = await new Promise<number>((r) => b.on("exit", (c) => r(c ?? 1)));
    if (code !== 0) throw new Error(`next build failed:\n${nextLog.slice(-1500)}`);
  }
  const next = spawn(path.resolve("node_modules/.bin/next"), ["start", "-p", String(appPort)], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  next.stdout.on("data", (d: Buffer) => (nextLog += d.toString()));
  next.stderr.on("data", (d: Buffer) => (nextLog += d.toString()));
  for (let i = 0; i < 240 && !/Ready in|started server|Local:/.test(nextLog); i++) await new Promise((r) => setTimeout(r, 250));

  const rt = createWorkerRuntime(env);
  const formHost = await startFormHost();
  const browser = await chromium.launch({ headless: true });
  const workerLog: string[] = [];
  const worker = new BrowserWorker({ ...rt, formHost, launchBrowser: async () => browser, pollMs: 200, heartbeatMs: 500, extraProviders: () => createLlmProviders(env), logger: { info: (...a) => workerLog.push(a.join(" ")), warn: (...a) => workerLog.push(a.join(" ")), error: (...a) => workerLog.push(a.join(" ")) } });
  worker.start();

  // Isolated submission receiver: serves a copy of the ATS-style form and records POSTs. Forwards nothing.
  const received: { at: string; bytes: number }[] = [];
  const receiver = http.createServer((req, res) => {
    if (req.method === "POST") {
      let n = 0;
      req.on("data", (c: Buffer) => (n += c.length));
      req.on("end", () => { received.push({ at: new Date().toISOString(), bytes: n }); res.end("Test submission recorded by the isolated receiver."); });
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end(fs.readFileSync(path.resolve("test-forms/greenhouse-like.html")));
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
  const receiverUrl = `http://127.0.0.1:${(receiver.address() as net.AddressInfo).port}/apply`;

  const A = SYNTHETIC_USERS[0]!, B = SYNTHETIC_USERS[1]!;
  const signIn = async (u: typeof A): Promise<BrowserContext> => {
    const ctx = await browser.newContext({ baseURL: appUrl, viewport: { width: 1280, height: 900 } });
    const c = await auth.sessionCookie(u);
    await ctx.addCookies([{ name: c.name, value: c.value, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
    return ctx;
  };

  try {
    // ---- A. Authentication
    {
      const anon = await browser.newContext({ baseURL: appUrl });
      const p = await anon.newPage();
      await p.goto("/apply/profile", { timeout: 90_000 });
      const redirected = new URL(p.url()).pathname === "/auth/login";
      await anon.close();
      record("A. Authentication (protected pages)", redirected ? "PASS" : "FAIL", redirected ? "Anonymous visit to /apply/profile redirected to /auth/login by the team middleware" : `Not redirected: ${p.url()}`, [], "LOCAL REAL middleware + MOCK auth (not real Supabase)");
    }
    const ctxA = await signIn(A);
    const page = await ctxA.newPage();
    watch(page, "userA");

    // ---- B. Resume upload
    await page.goto("/apply/profile", { timeout: 90_000 });
    await page.setInputFiles("#resume-file", { name: "morgan-lee-resume.pdf", mimeType: "application/pdf", buffer: Buffer.from(resumeBytes) });
    await page.getByRole("button", { name: /upload and extract/i }).click();
    await page.waitForFunction(() => (document.querySelector("[name='contact.email']") as HTMLInputElement | null)?.value, undefined, { timeout: 60_000 });
    const sB = await shot(page, "B-uploaded-profile");
    const prof = await rt.repos.profiles.get(A.id);
    const resumeRec = prof?.resumeId ? await rt.repos.resumes.get(A.id, prof.resumeId) : null;
    const stored = resumeRec ? await rt.storage.get(resumeRec.storageKey) : null;
    const sameBytes = !!stored && Buffer.compare(Buffer.from(stored), Buffer.from(resumeBytes)) === 0;
    record("B. Resume upload", resumeRec && sameBytes && resumeRec.storageKey.startsWith(`${A.id}/`) ? "PASS" : "FAIL", `DB resume row ${resumeRec?.id ?? "missing"} (owner ${resumeRec?.userId === A.id ? "user A" : "WRONG"}), key ${resumeRec?.storageKey}, stored bytes identical: ${sameBytes}`, [sB], "LOCAL REAL (Postgres via PGlite, file storage; S3 path verified separately)");

    // ---- C. Parsing accuracy
    const p0 = prof!.profile;
    const checks: [string, boolean][] = [
      ["name", p0.contact.fullName?.value === MORGAN.fullName], ["email", p0.contact.email?.value === MORGAN.email], ["phone", p0.contact.phone?.value.replace(/\D/g, "") === MORGAN.phone.replace(/\D/g, "")],
      ["location", p0.contact.location?.value === MORGAN.location], ["linkedin", p0.contact.linkedin?.value === MORGAN.linkedin], ["github", p0.contact.github?.value === MORGAN.github], ["summary", p0.summary === MORGAN.summary],
      ...MORGAN.experience.flatMap((e, i): [string, boolean][] => [[`exp${i + 1}.title`, p0.experience[i]?.title === e.title], [`exp${i + 1}.company`, p0.experience[i]?.company === e.company], [`exp${i + 1}.dates`, p0.experience[i]?.start === e.start && p0.experience[i]?.end === e.end], [`exp${i + 1}.bullets`, JSON.stringify(p0.experience[i]?.bullets) === JSON.stringify(e.bullets)]]),
      ["edu.degree", p0.education[0]?.degree === MORGAN.education[0]!.degree], ["edu.institution", p0.education[0]?.institution === MORGAN.education[0]!.institution],
      ["skills", JSON.stringify(p0.skills) === JSON.stringify([...MORGAN.technicalSkills, ...MORGAN.softSkills])], ["no invented roles", p0.experience.length === 2],
    ];
    const ok = checks.filter(([, v]) => v).length;
    record("C. Resume parsing", ok === checks.length ? "PASS" : "PARTIAL", `Field-level accuracy ${ok}/${checks.length}${ok < checks.length ? `; wrong: ${checks.filter(([, v]) => !v).map(([k]) => k).join(", ")}` : ""}`, [sB], "LOCAL REAL (unpdf + deterministic parser, no LLM)");

    // ---- D. Profile review and edits
    await page.fill("[name='pref.workAuthCountry']", "Australia");
    await page.selectOption("[name='pref.workAuthorized']", "yes");
    await page.selectOption("[name='pref.needsSponsorship']", "no");
    await page.fill("[name='pref.salaryExpectation']", "165000");
    await page.fill("[name='pref.referralSource']", "LinkedIn");
    await page.fill("[name='contact.phone']", "+61 412 555 020"); // user correction
    await page.getByRole("button", { name: "Save profile" }).click();
    await page.getByRole("status").filter({ hasText: "Saved." }).waitFor({ timeout: 60_000 });
    await page.reload();
    const phoneAfter = await page.inputValue("[name='contact.phone']");
    const badge = await page.locator("label[for='contact.phone']").innerText();
    // Re-upload must not overwrite the confirmed phone.
    await page.setInputFiles("#resume-file", { name: "morgan-lee-resume.pdf", mimeType: "application/pdf", buffer: Buffer.from(resumeBytes) });
    await page.getByRole("button", { name: /replace resume/i }).click();
    await page.getByText("Resume processed").waitFor({ timeout: 60_000 });
    await page.reload();
    const phoneAfterReupload = await page.inputValue("[name='contact.phone']");
    const sD = await shot(page, "D-profile-after-edit-refresh-reupload");
    record("D. Profile review", phoneAfter === "+61 412 555 020" && /confirmed by you/.test(badge) && phoneAfterReupload === "+61 412 555 020" ? "PASS" : "FAIL", `Edit persisted after refresh (${phoneAfter}), badge "${badge.replace(/\s+/g, " ")}", kept after re-upload (${phoneAfterReupload})`, [sD], "LOCAL REAL");

    // ---- Session expiry
    {
      const tmp = await signIn(A);
      const pp = await tmp.newPage();
      await pp.goto("/apply/profile", { timeout: 60_000 });
      await pp.getByRole("button", { name: "Save profile" }).waitFor();
      await tmp.clearCookies();
      await pp.getByRole("button", { name: "Save profile" }).click();
      const msg = await pp.getByRole("status").filter({ hasText: "session expired" }).waitFor({ timeout: 30_000 }).then(() => true, () => false);
      await tmp.close();
      record("A2. Session expiry", msg ? "PASS" : "FAIL", msg ? "Saving after the session ended shows 'Your session expired. Please sign in again.'" : "No session-expired message", [], "LOCAL REAL + MOCK auth");
    }

    // ---- E. Job import (live, read-only Greenhouse)
    let jobUrl = "";
    try {
      const list = (await safeFetchJson("https://boards-api.greenhouse.io/v1/boards/anthropic/jobs")) as { jobs: { id: number; title: string }[] };
      const pick = list.jobs.find((j) => /software engineer|full[- ]stack|frontend/i.test(j.title)) ?? list.jobs[0]!;
      jobUrl = `https://boards.greenhouse.io/anthropic/jobs/${pick.id}`;
    } catch { /* offline */ }
    await page.goto("/apply/jobs");
    if (jobUrl) {
      await page.fill("#job-link", jobUrl);
      await page.getByRole("button", { name: "Read posting" }).click();
      const review = page.getByRole("form", { name: "Review imported posting" });
      await review.waitFor({ timeout: 60_000 });
      const title = await review.getByLabel("Title").inputValue();
      const req = (await review.getByLabel("Requirements (one per line)").inputValue()).split("\n").filter(Boolean).length;
      const pref = (await review.getByLabel("Nice to have (one per line)").inputValue()).split("\n").filter(Boolean).length;
      const sE = await shot(page, "E-imported-posting-review");
      await review.getByRole("button", { name: "Save to my jobs" }).click();
      await page.waitForURL(/\/apply\/jobs\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      record("E. Job import", title && req > 0 ? "PASS" : "PARTIAL", `Live public posting "${title}" (${jobUrl}): ${req} required, ${pref} preferred qualifications extracted; saved to user A's workspace`, [sE], "LIVE (read-only public Greenhouse Job Board API)");
    } else {
      record("E. Job import", "BLOCKED", "Live job board unreachable", [], "NOT TESTED");
    }
    const postingId = page.url().split("/").pop()!;

    // ---- F. Matching
    await page.getByRole("button", { name: "Check my match" }).click();
    await page.getByText(/requirements are stated in your profile/).waitFor({ timeout: 60_000 });
    const posting = await rt.repos.postings.get(A.id, postingId);
    const m = posting!.match as { score: number; band: string; requirements: { status: string; text: string; evidence: string[] }[]; matchedSkills: string[]; missingSkills: string[]; blockers: unknown[] };
    const counts = m.requirements.reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
    const invented = m.requirements.filter((r) => r.status === "supported" && r.evidence.length === 0).length;
    const sF = await shot(page, "F-match");
    record("F. Job matching", invented === 0 ? "PASS" : "FAIL", `Score ${m.score}/5 (${m.band}); statuses ${JSON.stringify(counts)}; matched skills ${m.matchedSkills.join(", ") || "none"}; 'supported' without quoted evidence: ${invented}`, [sF], "LOCAL REAL (deterministic matcher; no LLM)");

    // ---- G. Tailoring
    await page.getByRole("button", { name: "Suggest tailoring" }).click();
    const decisions = page.getByRole("form", { name: "Tailoring decisions" });
    await decisions.waitFor({ timeout: 60_000 });
    for (const r of await decisions.getByLabel("Accept").all()) await r.check();
    const why = decisions.getByLabel(/^Answer: Why are you interested in/);
    if (await why.count()) {
      await why.fill("I want to build reliable, data-heavy products with TypeScript and React, and I enjoy mentoring.");
      await decisions.getByLabel("Use this answer").first().check();
    }
    await decisions.getByRole("button", { name: "Save decisions" }).click();
    await page.getByRole("button", { name: "Generate tailored resume (PDF)" }).click();
    const dl = page.getByRole("link", { name: "Download tailored resume" });
    await dl.waitFor({ timeout: 60_000 });
    const pdfRes = await ctxA.request.get((await dl.getAttribute("href"))!);
    const pdfBuf = new Uint8Array(await pdfRes.body());
    fs.writeFileSync(path.join(out, "G-tailored-resume.pdf"), pdfBuf);
    const pdfText = await extractResumeText(pdfBuf, "pdf");
    const originalStill = await rt.storage.get(resumeRec!.storageKey);
    const unchanged = !!originalStill && Buffer.compare(Buffer.from(originalStill), Buffer.from(resumeBytes)) === 0;
    const inventedSkill = ["Kubernetes", "Go ", "Rust", "Java "].filter((k) => pdfText.includes(k) && !MORGAN.technicalSkills.join(" ").includes(k.trim()));
    const sG = await shot(page, "G-tailoring");
    record("G. Resume tailoring", pdfRes.headers()["content-type"] === "application/pdf" && pdfText.includes(MORGAN.fullName) && unchanged && inventedSkill.length === 0 ? "PASS" : "FAIL", `Tailored PDF opens (${pdfBuf.byteLength} bytes, text extracted), contains only profile facts (invented skills: ${inventedSkill.length}); original resume bytes unchanged: ${unchanged}`, [sG, path.relative(process.cwd(), path.join(out, "G-tailored-resume.pdf"))], "LOCAL REAL");

    // ---- H. Prepare + worker autofill
    await page.getByLabel("Test form to fill").selectOption("greenhouse-like");
    await page.getByLabel(/Use an LLM/).check();
    await page.getByRole("button", { name: "Prepare and start autofill" }).click();
    await page.waitForURL(/\/apply\/applications\//, { timeout: 60_000 });
    const appId = page.url().split("/").pop()!;
    const sQueued = await shot(page, "H-queued-or-running");
    await page.getByText("Filled, awaiting your review").first().waitFor({ timeout: 120_000 });
    await page.waitForTimeout(1500);
    const app = await rt.repos.applications.get(A.id, appId);
    const rep = app!.report!;
    const by = (re: RegExp) => rep.fields.find((f) => re.test(f.label));
    const expected: [RegExp, string | "human"][] = [[/^First Name/, "Morgan"], [/^Last Name/, "Lee"], [/^Email/, MORGAN.email], [/^Phone/, "+61 412 555 020"], [/^LinkedIn/, MORGAN.linkedin], [/legally authorized/, "Yes"], [/sponsorship/, "No"], [/How did you hear/, "LinkedIn"], [/^Gender/, "human"]];
    const fieldResults = expected.map(([re, want]) => { const f = by(re); return want === "human" ? f?.outcome === "needs_human" : f?.outcome === "verified" && String(f.value) === want; });
    const resumeAttached = rep.fields.find((f) => f.kind === "resume")?.outcome === "verified";
    const fieldsOk = fieldResults.filter(Boolean).length + (resumeAttached ? 1 : 0);
    const fieldsTotal = expected.length + 1;
    const latest = await rt.queue.latest(A.id, appId);
    const sH = await shot(page, "H-I-application-review");
    record("H. Worker autofill", fieldsOk === fieldsTotal ? "PASS" : "PARTIAL", `Job ${latest?.job.status} after ${latest?.job.attempts} attempt(s); autofill field accuracy ${fieldsOk}/${fieldsTotal} (incl. resume attached); ${rep.metrics.llmCalls} LLM call(s) (MOCK); tiers ${JSON.stringify(rep.metrics.byTier)}; submissions blocked ${rep.blockedSubmits.inPage + rep.blockedSubmits.network}; form host received ${formHost.submissions()} POSTs`, [sQueued, sH], "LOCAL REAL worker + Playwright; LLM MOCK");

    // ---- I. Human review + handoff + controlled submission
    const logs = latest!.logs.map((l) => `${l.level}: ${l.message}`);
    // next dev compiles the route on first hit and can drop that connection; retry once.
    const planRes = await ctxA.request.get(`/api/applications/${appId}/fill-plan`).catch(() => ctxA.request.get(`/api/applications/${appId}/fill-plan`));
    const plan = ((await planRes.json()) as { plan: ReturnType<typeof buildFillPlan> }).plan;
    const human = await browser.newContext({ viewport: { width: 1280, height: 900 } }); // the user's own browser
    const hp = await human.newPage();
    await hp.goto(receiverUrl);
    await hp.addScriptTag({ path: path.resolve("extension/filler.js") });
    const fill = await hp.evaluate((p) => (window as unknown as { __auraApplyPlan: (x: unknown) => Promise<{ filled: string[]; notFound: string[]; unconfirmed: string[]; needsInput: string[] }> }).__auraApplyPlan(p), plan);
    const sHand = await shot(hp, "I-handoff-filled-in-users-browser");
    await hp.selectOption("#gender", { label: "Decline to self-identify" }); // the person answers what was left for them
    await hp.getByRole("button", { name: "Submit Application" }).click(); // the PERSON submits, to the isolated receiver
    await hp.waitForLoadState();
    await human.close();
    await page.reload();
    await page.getByLabel(/submitted this application myself/).check();
    await page.getByRole("button", { name: "Record as submitted" }).click();
    await page.getByText("Submitted (confirmed by you)").first().waitFor({ timeout: 30_000 });
    const final = await rt.repos.applications.get(A.id, appId);
    const sI = await shot(page, "I-submitted-confirmed");
    record("I. Review, handoff, controlled submission", received.length === 1 && final?.status === "submitted_by_user" ? "PASS" : "FAIL", `Review shows grouped fields, tiers, screenshot, ${logs.length} log lines. Extension filler: ${fill.filled.length} filled, ${fill.unconfirmed.length} unconfirmed, ${fill.notFound.length} not found, ${fill.needsInput.length} left for the person. The person submitted to the isolated receiver (${received.length} POST recorded, nothing forwarded); status ${final?.status} (user-confirmed, not an employer-verified submission)`, [sHand, sI], "LOCAL REAL; receiver is a local stand-in");

    // ---- J. Second user isolation
    const ctxB = await signIn(B);
    const pb = await ctxB.newPage();
    watch(pb, "userB");
    const r1 = await pb.goto(`/apply/applications/${appId}`, { timeout: 60_000 });
    const r2 = await ctxB.request.get(`/api/applications/${appId}`);
    const r3 = await ctxB.request.get(`/api/applications/${appId}/screenshot`);
    const r4 = await ctxB.request.get(`/api/apply/resumes/${resumeRec!.id}`);
    const r5 = await ctxB.request.get(`/api/postings/${postingId}`);
    const r6 = await ctxB.request.get(`/api/profile`);
    const bProfile = (await r6.json()) as { profile?: null };
    const codes = [r1?.status(), r2.status(), r3.status(), r4.status(), r5.status()];
    record("J. Second-user isolation", codes.every((c) => c === 404) && bProfile.profile === null ? "PASS" : "FAIL", `User B: application page/API/screenshot/resume/posting -> ${codes.join("/")}; B's profile is empty`, [], "LOCAL REAL + MOCK auth");
    await ctxB.close();

    fs.writeFileSync(path.join(out, "worker-logs.txt"), logs.join("\n"));
    record("Console / network", consoleErrors.length === 0 && failedRequests.length === 0 ? "PASS" : "PARTIAL", `${consoleErrors.length} browser console errors, ${failedRequests.length} unexpected failed API requests`, [], "LOCAL REAL");
    if (consoleErrors.length || failedRequests.length) fs.writeFileSync(path.join(out, "console-and-network.txt"), [...consoleErrors, ...failedRequests].join("\n"));
  } catch (e) {
    record("Run", "FAIL", e instanceof Error ? e.message.split("\n")[0]! : String(e), [], "-");
  } finally {
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({ stages, consoleErrors, failedRequests }, null, 2));
    fs.writeFileSync(path.join(out, "next.log"), nextLog);
    await worker.stop();
    await formHost.close();
    await browser.close();
    await rt.close();
    receiver.close();
    if (next.pid) try { process.kill(-next.pid, "SIGKILL"); } catch { /* exited */ }
    await auth.close();
    await db.stop();
    console.log(`\nArtifacts: ${path.relative(process.cwd(), out)}`);
    process.exit(stages.every((s) => s.status === "PASS") ? 0 : 1);
  }
}

void main();
