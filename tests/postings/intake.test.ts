/** Job intake: URL allowlist, SSRF-safe fetch, provider adapters (SYNTHETIC fixtures, no network), extraction. */
import { describe, expect, it } from "vitest";

import { extractRequirements, htmlToText } from "~/lib/postings/extract";
import { draftFromManual, previewFromUrl } from "~/server/postings/intake";
import { RateLimiter } from "~/server/postings/rate-limit";
import { FetchBlockedError, isPrivateAddress, safeFetchJson } from "~/server/postings/safe-fetch";
import { parsePostingUrl } from "~/server/postings/url";

const publicLookup = async () => ["104.18.1.1"];
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
const fetchOf = (routes: Record<string, () => Response>) => {
  const seen: string[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push(String(url));
    expect(init?.redirect).toBe("error");
    const hit = Object.entries(routes).find(([k]) => String(url).startsWith(k));
    return hit ? hit[1]() : new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { f, seen };
};

const JD_HTML = "<h3>About the role</h3><p>Build our platform.</p><h3>Requirements</h3><ul><li>5+ years of experience with TypeScript</li><li>Experience with React and Node.js</li><li>Authorized to work in Australia</li></ul><h3>Nice to have</h3><ul><li>Kubernetes experience</li></ul><h3>Benefits</h3><ul><li>Free lunch</li></ul>";

describe("parsePostingUrl", () => {
  it.each([
    ["https://boards.greenhouse.io/examplecorp/jobs/12345", "greenhouse"],
    ["https://job-boards.greenhouse.io/examplecorp/jobs/12345?gh_src=x", "greenhouse"],
    ["https://jobs.lever.co/examplecorp/0b1c2d3e-1111-4222-8333-444455556666/apply", "lever"],
    ["https://jobs.eu.lever.co/examplecorp/0b1c2d3e-1111-4222-8333-444455556666", "lever"],
    ["https://jobs.ashbyhq.com/examplecorp/0b1c2d3e-1111-4222-8333-444455556666/application", "ashby"],
  ])("accepts %s", (url, source) => expect(parsePostingUrl(url)).toMatchObject({ ok: true, source }));
  it.each([
    "http://boards.greenhouse.io/x/jobs/1",
    "https://evil.example/jobs/1",
    "https://boards.greenhouse.io.evil.example/x/jobs/1",
    "https://user:pw@boards.greenhouse.io/x/jobs/1",
    "https://boards.greenhouse.io:8443/x/jobs/1",
    "https://boards.greenhouse.io/x/jobs/1;DROP",
    "https://jobs.lever.co/x/not-a-uuid",
    "https://169.254.169.254/latest/meta-data",
    "javascript:alert(1)",
  ])("rejects %s", (url) => expect(parsePostingUrl(url).ok).toBe(false));
});

describe("safeFetchJson", () => {
  it("only talks to allow-listed API hosts", async () => {
    await expect(safeFetchJson("https://example.com/x", { lookup: publicLookup })).rejects.toMatchObject({ code: "host_not_allowed" });
  });
  it("blocks hosts that resolve to private addresses (DNS rebinding)", async () => {
    await expect(safeFetchJson("https://api.lever.co/v0/postings/x", { lookup: async () => ["10.0.0.5"] })).rejects.toMatchObject({ code: "private_address" });
    expect(["127.0.0.1", "169.254.169.254", "192.168.1.1", "::1", "fd00::1", "::ffff:10.0.0.1"].every(isPrivateAddress)).toBe(true);
    expect(isPrivateAddress("104.18.1.1")).toBe(false);
  });
  it("refuses redirects, caps size and times out", async () => {
    const redirect = (async () => {
      throw new TypeError("redirect mode is set to error");
    }) as typeof fetch;
    await expect(safeFetchJson("https://api.lever.co/v0/postings/x", { lookup: publicLookup, fetchImpl: redirect })).rejects.toMatchObject({ code: "redirect" });
    const big = (async () => new Response("x".repeat(2000), { status: 200 })) as typeof fetch;
    await expect(safeFetchJson("https://api.lever.co/v0/postings/x", { lookup: publicLookup, fetchImpl: big, maxBytes: 1000 })).rejects.toMatchObject({ code: "too_large" });
    const hang = ((_u: unknown, init?: RequestInit) => new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("t"), { name: "TimeoutError" }))))) as typeof fetch;
    await expect(safeFetchJson("https://api.lever.co/v0/postings/x", { lookup: publicLookup, fetchImpl: hang, timeoutMs: 50 })).rejects.toBeInstanceOf(FetchBlockedError);
  });
});

describe("provider adapters (synthetic fixtures)", () => {
  const lim = () => new RateLimiter(100, 60_000);
  it("Greenhouse: escaped HTML content, location, requirements", async () => {
    const { f, seen } = fetchOf({ "https://boards-api.greenhouse.io/v1/boards/examplecorp/jobs/12345": () => json({ id: 12345, title: "Senior Engineer", absolute_url: "https://boards.greenhouse.io/examplecorp/jobs/12345", location: { name: "Melbourne, Australia" }, content: JD_HTML.replace(/</g, "&lt;").replace(/>/g, "&gt;") }) });
    const r = await previewFromUrl("u1", "https://boards.greenhouse.io/examplecorp/jobs/12345", { fetchImpl: f, lookup: publicLookup, limiter: lim() });
    expect(seen).toEqual(["https://boards-api.greenhouse.io/v1/boards/examplecorp/jobs/12345"]);
    expect(r).toMatchObject({ ok: true, draft: { source: "greenhouse", title: "Senior Engineer", company: "Examplecorp", location: "Melbourne, Australia", retrieval: "live_api", externalId: "examplecorp:12345" } });
    if (r.ok) expect(r.draft.requirements).toEqual({ required: ["5+ years of experience with TypeScript", "Experience with React and Node.js", "Authorized to work in Australia"], preferred: ["Kubernetes experience"] });
  });
  it("Lever: lists become requirement sections", async () => {
    const id = "0b1c2d3e-1111-4222-8333-444455556666";
    const { f } = fetchOf({ [`https://api.lever.co/v0/postings/examplecorp/${id}`]: () => json({ id, text: "Platform Engineer", hostedUrl: `https://jobs.lever.co/examplecorp/${id}`, categories: { location: "Remote" }, descriptionPlain: "We build things.", lists: [{ text: "What We Require", content: "<li>Go or TypeScript</li><li>3+ years of experience</li>" }, { text: "Nice to have", content: "<li>Terraform</li>" }] }) });
    const r = await previewFromUrl("u1", `https://jobs.lever.co/examplecorp/${id}`, { fetchImpl: f, lookup: publicLookup, limiter: lim() });
    expect(r.ok && r.draft.requirements).toEqual({ required: ["Go or TypeScript", "3+ years of experience"], preferred: ["Terraform"] });
  });
  it("Ashby: finds the posting on the board, 404 when absent", async () => {
    const id = "0b1c2d3e-1111-4222-8333-444455556666";
    const { f } = fetchOf({ "https://api.ashbyhq.com/posting-api/job-board/examplecorp": () => json({ jobs: [{ id, title: "Data Engineer", location: "Sydney", descriptionPlain: "ABOUT THE ROLE\nWe move data around for our customers every single day.\nYOU MIGHT THRIVE IN THIS ROLE IF YOU:\n - Know Python and SQL\n - Like Spark", jobUrl: `https://jobs.ashbyhq.com/examplecorp/${id}` }] }) });
    const r = await previewFromUrl("u1", `https://jobs.ashbyhq.com/examplecorp/${id}`, { fetchImpl: f, lookup: publicLookup, limiter: lim() });
    expect(r.ok && r.draft.requirements.required).toEqual(["Know Python and SQL", "Like Spark"]);
    const missing = await previewFromUrl("u1", "https://jobs.ashbyhq.com/examplecorp/11111111-1111-4111-8111-111111111111", { fetchImpl: f, lookup: publicLookup, limiter: lim() });
    expect(missing).toMatchObject({ ok: false, status: 404 });
  });
  it("unsupported sites and closed postings explain the manual fallback", async () => {
    expect(await previewFromUrl("u1", "https://careers.example.com/job/1", { limiter: lim() })).toMatchObject({ ok: false, status: 422, error: expect.stringContaining("Paste the job description") });
    const { f } = fetchOf({});
    expect(await previewFromUrl("u1", "https://boards.greenhouse.io/x/jobs/9", { fetchImpl: f, lookup: publicLookup, limiter: lim() })).toMatchObject({ ok: false, status: 404, error: expect.stringContaining("manually") });
  });
  it("rate limits per user", async () => {
    const limiter = new RateLimiter(2, 60_000);
    const { f } = fetchOf({});
    for (let i = 0; i < 2; i++) await previewFromUrl("u1", "https://boards.greenhouse.io/x/jobs/9", { fetchImpl: f, lookup: publicLookup, limiter });
    expect(await previewFromUrl("u1", "https://boards.greenhouse.io/x/jobs/9", { fetchImpl: f, lookup: publicLookup, limiter })).toMatchObject({ status: 429 });
    expect(await previewFromUrl("u2", "https://boards.greenhouse.io/x/jobs/9", { fetchImpl: f, lookup: publicLookup, limiter })).toMatchObject({ ok: false, status: 404 });
  });
});

describe("extraction", () => {
  it("handles plain-sentence items, structural headings and entities", () => {
    const text = htmlToText("<p>Minimum qualifications</p><p>Have shipped production systems.</p><p>Preferred qualifications</p><p>Experience with IPO readiness.</p><p>Annual Salary:</p><p>$190,000&amp;mdash;$230,000 USD</p>");
    expect(extractRequirements(text)).toEqual({ required: ["Have shipped production systems."], preferred: ["Experience with IPO readiness."] });
  });
  it("manual fallback extracts requirements and is marked manual", () => {
    const d = draftFromManual({ title: "Engineer", company: "Example Corp", description: "Requirements:\n- TypeScript\n- React" });
    expect(d).toMatchObject({ source: "manual", retrieval: "manual", requirements: { required: ["TypeScript", "React"], preferred: [] } });
  });
});
