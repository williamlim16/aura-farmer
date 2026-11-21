"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge, type BadgeTone } from "~/components/apply/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { APPLICATION_TARGETS } from "~/lib/applications/targets";
import type { ApplicationStatus } from "~/lib/applications/status";
import { statusView } from "~/lib/applications/view";
import { apiFetch } from "~/lib/client/api";
import type { EvidenceStatus, MatchResult } from "~/lib/match/match";
import type { PostingRequirements } from "~/lib/postings/types";
import type { Tailoring } from "~/lib/tailor/tailor";

export interface PostingDTO {
  id: string;
  source: string;
  sourceUrl: string | null;
  title: string;
  company: string;
  location: string;
  description: string;
  requirements: PostingRequirements;
  retrieval: "live_api" | "manual";
  match: MatchResult | null;
  tailoring: Tailoring | null;
}

const EVIDENCE: Record<EvidenceStatus, [string, BadgeTone]> = {
  supported: ["Stated in your profile", "success"],
  partial: ["Partly stated", "warning"],
  inferred: ["Inferred (not verified)", "progress"],
  unverified: ["Not in your profile", "neutral"],
  gap: ["Gap", "danger"],
};
const BAND: Record<MatchResult["band"], [string, BadgeTone]> = { strong: ["Strong match", "success"], good: ["Good match", "success"], partial: ["Partial match", "warning"], weak: ["Weak match", "danger"] };
const area = "border-input min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-sm";

export function JobWorkspace({ initial, hasProfile, llm, applications }: { initial: PostingDTO; hasProfile: boolean; llm: { available: boolean; label: string }; applications: { id: string; status: ApplicationStatus; createdAt: string }[] }) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [targetKey, setTargetKey] = useState("full-application");
  const [useLlm, setUseLlm] = useState(false);
  const [editReqs, setEditReqs] = useState(false);

  async function call<T>(label: string, url: string, method: string, body?: unknown): Promise<T | null> {
    setBusy(label);
    setError("");
    const r = await apiFetch<T>(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return null;
    }
    return r.data;
  }
  const refreshWith = (d: { posting: PostingDTO } | null) => d && setP(d.posting);

  const t = p.tailoring;
  const decided = t ? t.suggestions.filter((s) => s.status !== "pending").length + t.answers.filter((a) => a.status !== "pending").length : 0;
  const latestApp = applications[0];
  const stages = [
    { label: "Saved", done: true },
    { label: "Matched", done: !!p.match },
    { label: "Tailored", done: !!t && decided > 0 },
    { label: "Resume ready", done: !!t?.tailoredResumeId },
    { label: latestApp ? statusView(latestApp.status).label : "Application", done: !!latestApp },
  ];

  async function saveDecisions(form: HTMLFormElement) {
    if (!t) return;
    const fd = new FormData(form);
    const get = (k: string) => { const v = fd.get(k); return typeof v === "string" ? v : ""; };
    const suggestions = Object.fromEntries(t.suggestions.map((s) => [s.id, get(`s:${s.id}`) || s.status]));
    const answers = Object.fromEntries(t.answers.map((a) => [a.id, { status: get(`a:${a.id}`) || a.status, answer: get(`text:${a.id}`) }]));
    refreshWith(await call<{ posting: PostingDTO }>("decide", `/api/postings/${p.id}/tailor`, "PUT", { suggestions, answers }));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{p.title}</h1>
          <p className="text-muted-foreground text-sm">{p.company}{p.location ? ` · ${p.location}` : ""}</p>
        </div>
        <span className="ml-auto flex gap-2">
          <Badge>{p.retrieval === "live_api" ? `Read from ${p.source}` : "Pasted by you"}</Badge>
          {p.sourceUrl && <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm underline">Original posting</a>}
        </span>
      </div>

      <ol aria-label="Progress" className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-5">
        {stages.map((s) => (
          <li key={s.label} className={`rounded-md border px-2 py-2 ${s.done ? "border-primary font-semibold" : "text-muted-foreground"}`}>{s.done ? "✓ " : ""}{s.label}</li>
        ))}
      </ol>
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      {!hasProfile && <p className="text-sm">Upload your resume on the <Link href="/apply/profile" className="underline">profile page</Link> to match and tailor.</p>}

      <Card>
        <CardHeader>
          <CardTitle>Requirements</CardTitle>
          <CardDescription>From the posting. Correct them if extraction missed something; your match updates from these.</CardDescription>
        </CardHeader>
        <CardContent>
          {editReqs ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const split = (k: string) => { const v = fd.get(k); return (typeof v === "string" ? v : "").split("\n").map((x) => x.trim()).filter(Boolean); };
                const d = await call<{ posting: PostingDTO }>("reqs", `/api/postings/${p.id}`, "PUT", { requirements: { required: split("required"), preferred: split("preferred") } });
                if (d) {
                  setP(d.posting);
                  setEditReqs(false);
                }
              }}
            >
              <label className="flex flex-col gap-1 text-sm">Required (one per line)<textarea name="required" className={area} defaultValue={p.requirements.required.join("\n")} /></label>
              <label className="flex flex-col gap-1 text-sm">Nice to have<textarea name="preferred" className={area} defaultValue={p.requirements.preferred.join("\n")} /></label>
              <div className="flex gap-2"><Button type="submit" disabled={!!busy}>Save requirements</Button><Button type="button" variant="outline" onClick={() => setEditReqs(false)}>Cancel</Button></div>
            </form>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div><h3 className="mb-1 text-sm font-semibold">Required</h3><ul className="list-disc pl-5 text-sm">{p.requirements.required.map((r) => <li key={r}>{r}</li>)}</ul>{!p.requirements.required.length && <p className="text-muted-foreground text-sm">None found. Add them for a meaningful match.</p>}</div>
              <div><h3 className="mb-1 text-sm font-semibold">Nice to have</h3><ul className="list-disc pl-5 text-sm">{p.requirements.preferred.map((r) => <li key={r}>{r}</li>)}</ul></div>
              <div><Button type="button" variant="outline" size="sm" onClick={() => setEditReqs(true)}>Edit requirements</Button></div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How your profile matches</CardTitle>
          <CardDescription>Only what your profile states counts as evidence. Inferences are labelled; work rights, sponsorship and per-skill years are never assumed.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div><Button onClick={async () => refreshWith(await call<{ posting: PostingDTO }>("match", `/api/postings/${p.id}/match`, "POST"))} disabled={!hasProfile || !!busy}>{busy === "match" ? "Checking…" : p.match ? "Re-check match" : "Check my match"}</Button></div>
          {p.match && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={BAND[p.match.band][1]} className="text-sm">{`${BAND[p.match.band][0]} · ${p.match.score.toFixed(1)} / 5`}</Badge>
                <p className="text-sm">{p.match.summary}</p>
              </div>
              {p.match.blockers.length > 0 && (
                <ul className="flex flex-col gap-1" aria-label="Potential blockers">
                  {p.match.blockers.map((b, i) => (
                    <li key={i} className={`rounded-md border px-3 py-2 text-sm ${b.severity === "blocker" ? "border-red-300 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100" : "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"}`}>
                      <strong>{b.severity === "blocker" ? "Blocker" : "Check"}:</strong> {b.detail}
                    </li>
                  ))}
                </ul>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-muted-foreground text-xs"><tr><th className="py-1 pr-3 font-medium">Requirement</th><th className="py-1 pr-3 font-medium">Status</th><th className="py-1 font-medium">Evidence from your profile</th></tr></thead>
                  <tbody>
                    {p.match.requirements.map((r) => (
                      <tr key={r.text} className="border-t align-top">
                        <td className="py-2 pr-3">{r.text}{r.importance === "preferred" && <span className="text-muted-foreground ml-1 text-xs">nice to have</span>}</td>
                        <td className="py-2 pr-3"><Badge tone={EVIDENCE[r.status][1]}>{EVIDENCE[r.status][0]}</Badge></td>
                        <td className="py-2">{r.evidence.length ? <ul className="text-xs">{r.evidence.map((e) => <li key={e}>“{e}”</li>)}</ul> : <span className="text-muted-foreground text-xs">None</span>}{r.note && <p className="text-muted-foreground mt-1 text-xs">{r.note}</p>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {p.match.relevantExperience.length > 0 && <p className="text-sm"><strong>Relevant experience:</strong> {p.match.relevantExperience.map((e) => `${e.title} at ${e.company} (${e.why})`).join("; ")}</p>}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tailor your resume and answers</CardTitle>
          <CardDescription>Suggestions only reorder or reuse facts already in your profile. Nothing is added. Your original resume is kept.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div><Button variant="outline" onClick={async () => refreshWith(await call<{ posting: PostingDTO }>("tailor", `/api/postings/${p.id}/tailor`, "POST"))} disabled={!hasProfile || !!busy}>{busy === "tailor" ? "Thinking…" : t ? "Regenerate suggestions" : "Suggest tailoring"}</Button></div>
          {t && (
            <form className="flex flex-col gap-4" aria-label="Tailoring decisions" onSubmit={(e) => { e.preventDefault(); void saveDecisions(e.currentTarget); }}>
              {t.suggestions.length === 0 && <p className="text-muted-foreground text-sm">No changes suggested: your resume already leads with what this job asks for.</p>}
              {t.suggestions.map((s) => (
                <fieldset key={s.id} className="rounded-md border p-3">
                  <legend className="px-1 text-sm font-semibold">{s.title}</legend>
                  <p className="text-muted-foreground text-xs">{s.rationale}</p>
                  <div className="mt-2 grid gap-3 text-xs sm:grid-cols-2">
                    <div><p className="font-medium">Now</p><ol className="list-decimal pl-4">{s.before.map((x, i) => <li key={i}>{x}</li>)}</ol></div>
                    <div><p className="font-medium">Suggested</p><ol className="list-decimal pl-4">{s.after.map((x, i) => <li key={i}>{x}</li>)}</ol></div>
                  </div>
                  <div className="mt-2 flex gap-4 text-sm">
                    {(["accepted", "rejected"] as const).map((v) => (
                      <label key={v} className="flex items-center gap-1"><input type="radio" name={`s:${s.id}`} value={v} defaultChecked={s.status === v} /> {v === "accepted" ? "Accept" : "Reject"}</label>
                    ))}
                  </div>
                </fieldset>
              ))}
              {t.answers.length > 0 && <h3 className="text-sm font-semibold">Draft answers for application questions</h3>}
              {t.answers.map((a) => (
                <fieldset key={a.id} className="rounded-md border p-3">
                  <legend className="px-1 text-sm font-semibold">{a.question}</legend>
                  <Badge tone={a.source === "profile" ? "success" : "warning"}>{a.source === "profile" ? "From your profile" : "Template draft: edit before using"}</Badge>
                  <textarea name={`text:${a.id}`} className={`${area} mt-2`} defaultValue={a.answer} aria-label={`Answer: ${a.question}`} />
                  <div className="mt-2 flex gap-4 text-sm">
                    {(["accepted", "rejected"] as const).map((v) => (
                      <label key={v} className="flex items-center gap-1"><input type="radio" name={`a:${a.id}`} value={v} defaultChecked={a.status === v} /> {v === "accepted" ? "Use this answer" : "Don't use"}</label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={!!busy}>{busy === "decide" ? "Saving…" : "Save decisions"}</Button>
                <Button type="button" variant="outline" disabled={!!busy || decided === 0} onClick={async () => refreshWith(await call<{ posting: PostingDTO }>("pdf", `/api/postings/${p.id}/resume`, "POST"))}>{busy === "pdf" ? "Generating…" : "Generate tailored resume (PDF)"}</Button>
                {t.tailoredResumeId && <a className="text-sm underline" href={`/api/apply/resumes/${t.tailoredResumeId}`}>Download tailored resume</a>}
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Prepare the application</CardTitle>
          <CardDescription>
            Uses your tailored profile, approved answers and tailored resume (or the original if you did not generate one). Filling the real {p.source !== "manual" ? p.source : "employer"} page is not automated yet: rehearse on a test form here, then use the browser handoff to fill the real form in your own browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Test form to fill
            <select value={targetKey} onChange={(e) => setTargetKey(e.target.value)} className="border-input h-9 max-w-md rounded-md border bg-transparent px-3 text-sm">
              {APPLICATION_TARGETS.filter((x) => x.key !== "trap").map((x) => <option key={x.key} value={x.key}>{x.title} · {x.company}</option>)}
            </select>
          </label>
          <label className={`flex items-start gap-2 text-sm ${llm.available ? "" : "opacity-60"}`}>
            <input type="checkbox" checked={useLlm} disabled={!llm.available} onChange={(e) => setUseLlm(e.target.checked)} className="mt-1" />
            <span>Use an LLM for questions rules cannot answer <span className="text-muted-foreground block text-xs">Provider: {llm.label}</span></span>
          </label>
          <div>
            <Button
              disabled={!hasProfile || !!busy}
              onClick={async () => {
                const d = await call<{ application: { id: string } }>("prepare", `/api/postings/${p.id}/prepare`, "POST", { targetKey, useLlm: llm.available && useLlm, start: true });
                if (d) router.push(`/apply/applications/${d.application.id}`);
              }}
            >
              {busy === "prepare" ? "Preparing…" : "Prepare and start autofill"}
            </Button>
          </div>
          {applications.length > 0 && (
            <ul className="text-sm">
              {applications.map((a) => (
                <li key={a.id}><Link href={`/apply/applications/${a.id}`} className="underline">{new Date(a.createdAt).toLocaleString()}</Link> · {statusView(a.status).label}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
