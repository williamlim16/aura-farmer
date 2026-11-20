import { afterAll, describe, expect, it } from "vitest";

import { ingestHandler, putProfileHandler, type ApiDeps } from "~/server/api/handlers";
import { decideTailoringHandler, deletePostingHandler, generateTailoredResumeHandler, getPostingHandler, listPostingsHandler, matchPostingHandler, preparePostingApplicationHandler, savePostingHandler, tailorPostingHandler, updatePostingHandler } from "~/server/api/postings";
import { MemoryJobQueue } from "~/server/jobs/memory";
import { PostgresJobQueue } from "~/server/jobs/postgres";
import { createMemoryRepos } from "~/server/repos/memory";
import { createPostgresRepos } from "~/server/repos/postgres";
import { MemoryStorage } from "~/server/storage/memory";
import { createTestDb } from "../helpers/pglite";
import { fileFrom, makePdf } from "../helpers/resume-fixtures";

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const BOB = "bbbbbbbb-0000-4000-8000-000000000002";
const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const c of closers) await c();
});

const JD = "About the role\nWe build web platforms.\nRequirements:\n- 5+ years of experience with TypeScript\n- Experience with React and Node.js\n- Authorized to work in Australia\nNice to have:\n- Kubernetes";
const impls: [string, () => Promise<ApiDeps>][] = [
  ["memory", async () => { const repos = createMemoryRepos(); return { repos, storage: new MemoryStorage(), queue: new MemoryJobQueue(repos) }; }],
  ["postgres (PGlite)", async () => { const t = await createTestDb(); closers.push(t.close); return { repos: createPostgresRepos(t.db), storage: new MemoryStorage(), queue: new PostgresJobQueue(t.db) }; }],
];

describe.each(impls)("posting workflow handlers: %s", (_n, make) => {
  it("manual JD -> match -> tailor -> decide -> tailored resume -> prepared application", async () => {
    const deps = await make();
    await ingestHandler(ALICE, fileFrom(await makePdf(), "cv.pdf"), deps);
    await putProfileHandler(ALICE, { expectedVersion: 1, preferences: { workAuthCountry: "Australia", workAuthorized: "yes", needsSponsorship: "no" } }, deps);

    expect((await savePostingHandler(ALICE, { kind: "manual", title: "Engineer", company: "Example Corp", description: "too short" }, deps)).status).toBe(400);
    const saved = await savePostingHandler(ALICE, { kind: "manual", title: "Senior Engineer", company: "Example Corp", location: "Melbourne", description: JD }, deps);
    expect(saved.status).toBe(201);
    const id = (saved.body as { posting: { id: string; requirements: { required: string[] } } }).posting.id;

    const matched = (await matchPostingHandler(ALICE, id, deps)).body as { posting: { match: { score: number; requirements: { status: string }[] } } };
    expect(matched.posting.match.requirements.map((r) => r.status)).toEqual(["inferred", "supported", "supported", "unverified"]);

    const tailored = (await tailorPostingHandler(ALICE, id, deps)).body as { posting: { tailoring: { suggestions: { id: string }[]; answers: { id: string }[] } } };
    const decisions = Object.fromEntries(tailored.posting.tailoring.suggestions.map((s) => [s.id, "accepted"]));
    await decideTailoringHandler(ALICE, id, { suggestions: decisions, answers: { why_company: { status: "accepted", answer: "I admire Example Corp's platform work." } } }, deps);

    const gen = await generateTailoredResumeHandler(ALICE, id, deps);
    expect(gen.status).toBe(201);
    const tailoredResumeId = (gen.body as { resumeId: string }).resumeId;
    const original = (await deps.repos.profiles.get(ALICE))!.resumeId;
    expect(tailoredResumeId).not.toBe(original); // original kept, tailored is a separate version
    expect((await deps.repos.resumes.get(ALICE, tailoredResumeId))!.filename).toMatch(/tailored\.pdf$/);

    const prep = await preparePostingApplicationHandler(ALICE, id, { targetKey: "full-application" }, deps);
    expect(prep.status).toBe(201);
    const appId = (prep.body as { application: { id: string; status: string } }).application.id;
    const app = (await deps.repos.applications.get(ALICE, appId))!;
    expect(app).toMatchObject({ status: "queued", postingId: id, resumeId: tailoredResumeId, title: "Senior Engineer" });
    expect(app.profileSnapshot.skills[0]).toBe("TypeScript");
    expect(app.profileSnapshot.preferences.savedAnswers?.["@why_company"]).toBe("I admire Example Corp's platform work.");
    // The stored profile itself is untouched by tailoring.
    expect((await deps.repos.profiles.get(ALICE))!.profile.preferences.savedAnswers?.["@why_company"]).toBeUndefined();
  });

  it("dedupes imports, isolates users, and edits invalidate the match", async () => {
    const deps = await make();
    const draft = { source: "greenhouse", sourceUrl: "https://boards.greenhouse.io/examplecorp/jobs/1", externalId: "examplecorp:1", title: "Engineer", company: "Example Corp", location: "", description: JD, requirements: { required: ["TypeScript"], preferred: [] } };
    const a = await savePostingHandler(ALICE, { kind: "imported", draft }, deps);
    const again = await savePostingHandler(ALICE, { kind: "imported", draft }, deps);
    expect([a.status, again.status]).toEqual([201, 200]);
    expect((again.body as { existed: boolean }).existed).toBe(true);
    const id = (a.body as { posting: { id: string } }).posting.id;
    expect((await getPostingHandler(BOB, id, deps)).status).toBe(404);
    expect((await updatePostingHandler(BOB, id, { title: "x" }, deps)).status).toBe(404);
    expect((await deletePostingHandler(BOB, id, deps)).status).toBe(404);
    expect(((await listPostingsHandler(BOB, deps)).body as { postings: unknown[] }).postings).toEqual([]);
    expect((await savePostingHandler(BOB, { kind: "imported", draft }, deps)).status).toBe(201); // Bob's own copy
    const upd = await updatePostingHandler(ALICE, id, { requirements: { required: ["Go"], preferred: [] } }, deps);
    expect((upd.body as { posting: { match: unknown } }).posting.match).toBeNull();
  });
});
