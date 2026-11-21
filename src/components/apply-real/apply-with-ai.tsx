"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Sparkles } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { cn } from "~/lib/utils";
import { answerableFields, answerControl, confidenceLabel, statusOf, type ReportField } from "./answers";

export const CONTACT_FIELDS = [
  ["fullName", "Full name"],
  ["firstName", "First name"],
  ["lastName", "Last name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["location", "Location (city, country)"],
  ["linkedin", "LinkedIn URL"],
  ["github", "GitHub URL"],
  ["website", "Website / portfolio URL"],
] as const;
export type ContactKey = (typeof CONTACT_FIELDS)[number][0];

interface Evidence {
  app: { ats: string; postingUrl: string; applyUrl: string; via: string };
  resume: { source: "tailored" | "uploaded"; filename: string };
  runtime: { executor: string; chromiumVersion: string; region: string | null; durationMs: number; providers: string[] };
  report: {
    fields: ReportField[];
    metrics: { verified: number; fields: number; required: number; requiredVerified: number; needsHuman: number; errors: number; mismatches: number };
  };
  blockedEgress: string[];
  screenshotJpegBase64: string;
  events: string[];
}

const TONE: Record<string, string> = {
  ok: "bg-green-500/15 text-green-700 dark:text-green-300",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  bad: "bg-red-500/15 text-red-700 dark:text-red-300",
  idle: "bg-muted text-muted-foreground",
};

export function ApplyWithAi({
  jobId,
  jobTitle,
  company,
  initialUrl,
  directlySupported,
  initialContact,
  profileSummary,
  resume,
}: {
  jobId: number | null;
  jobTitle: string | null;
  company: string | null;
  initialUrl: string;
  directlySupported: boolean;
  initialContact: Record<ContactKey, string>;
  profileSummary: { roles: number; education: number; skills: number };
  resume: { source: "tailored" | "uploaded"; fileName: string } | null;
}) {
  const [postingUrl, setPostingUrl] = useState(directlySupported || jobId === null ? initialUrl : "");
  const [contact, setContact] = useState(initialContact);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [review, setReview] = useState<Evidence | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/apply/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(jobId ? { jobId } : {}), postingUrl, contact, answers }),
      });
      const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as Evidence & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setReview(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const fields = review?.report.fields ?? [];
  const questions = answerableFields(fields, answers);
  const open = fields.filter((f) => f.outcome !== "verified" && f.label && f.control !== "file" && !(f.outcome === "skipped" && !f.required));
  const requiredOpen = fields.filter((f) => f.required && f.outcome !== "verified" && f.label && !(f.control === "file" && f.outcome === "skipped"));

  return (
    <div className="flex flex-col gap-6" data-testid="apply-with-ai">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="font-mono uppercase">Apply with AI</Badge>
            <Sparkles aria-hidden="true" className="text-aura-secondary size-4" />
          </div>
          <CardTitle className="text-lg">{jobTitle ? `${jobTitle}${company ? ` · ${company}` : ""}` : "Paste a job URL"}</CardTitle>
          <CardDescription>
            Fills the real Greenhouse or Lever application in a cloud browser using your Profile and resume, then shows what it filled, what it verified and what it needs from you. <strong>Review only: nothing is submitted to the employer.</strong>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="posting-url">Job posting URL (Greenhouse or Lever)</Label>
            <Input
              id="posting-url"
              placeholder="https://job-boards.greenhouse.io/<company>/jobs/<id>"
              value={postingUrl}
              onChange={(e) => setPostingUrl(e.target.value)}
            />
            {jobId !== null && !directlySupported && (
              <p className="text-muted-foreground text-xs">
                This job&apos;s listing page is not a Greenhouse or Lever application. Paste the employer&apos;s Greenhouse or Lever link for this role (usually behind the listing&apos;s Apply button), or leave it empty to let us look for one on the listing page.
              </p>
            )}
          </div>
          <div className="text-muted-foreground text-sm" data-testid="resume-source">
            {resume ? (
              <>Resume attached: <strong className="text-foreground">{resume.fileName}</strong> ({resume.source === "tailored" ? "tailored for this job" : "your uploaded resume"}).</>
            ) : (
              <>No resume on file. <Link href="/profile" className="underline">Upload one on your Profile</Link> first.</>
            )}{" "}
            Profile: {profileSummary.roles} roles, {profileSummary.education} education entries, {profileSummary.skills} skills.
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {CONTACT_FIELDS.map(([k, label]) => (
              <div key={k} className="flex flex-col gap-1">
                <Label htmlFor={`c-${k}`}>{label}</Label>
                <Input id={`c-${k}`} value={contact[k]} onChange={(e) => setContact({ ...contact, [k]: e.target.value })} />
              </div>
            ))}
          </div>
          <div>
            <Button onClick={run} disabled={busy || !resume || (!postingUrl && (jobId === null))} data-testid="run-review">
              {busy ? (<><Loader2 aria-hidden="true" className="animate-spin" /> Filling in the cloud… (up to a minute)</>) : review ? "Re-run with my answers" : "Fill application (review only)"}
            </Button>
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>

      {review && (
        <Card data-testid="review">
          <CardHeader>
            <CardTitle className="text-lg">Review the filled application</CardTitle>
            <CardDescription>
              {review.app.applyUrl} ({review.app.ats}) · filled by {review.runtime.executor}, Chromium {review.runtime.chromiumVersion}
              {review.runtime.region ? `, ${review.runtime.region}` : ""} in {(review.runtime.durationMs / 1000).toFixed(1)}s · resume: {review.resume.source === "tailored" ? "tailored" : "uploaded"} · not submitted
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p data-testid="metrics">
              <strong>{review.report.metrics.verified}</strong> of {review.report.metrics.fields} fields filled and read back · required {review.report.metrics.requiredVerified}/{review.report.metrics.required} · {open.length} need your answer
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b"><th className="p-1">Question</th><th className="p-1">Your answer</th><th className="p-1">Selected in the form</th><th className="p-1">Status</th><th className="p-1">Details</th></tr>
                </thead>
                <tbody>
                  {fields.map((f) => {
                    const st = statusOf(f);
                    const conf = confidenceLabel(f);
                    const typed = answers[f.label]?.trim();
                    return (
                      <tr key={`${f.step}-${f.id}`} className="border-b align-top">
                        <td className="p-1">{f.label || f.id}{f.required ? " *" : ""}{f.control === "file" ? " (file upload)" : ""}</td>
                        <td className="p-1 break-words">{f.control === "file" ? "—" : (typed ?? f.answer ?? <span className="text-muted-foreground">from your profile</span>)}</td>
                        <td className="p-1 break-all">{f.selected ?? (f.value === undefined || f.value === "" ? (f.control === "file" && f.outcome === "verified" ? "file attached" : "—") : String(f.value))}</td>
                        <td className="p-1"><span className={cn("rounded px-1", TONE[st.tone])}>{st.label}</span>{conf ? <span className="text-muted-foreground"> · {conf}</span> : null}</td>
                        <td className="p-1">
                          {f.outcome !== "verified" && f.reason ? <div>{f.reason}</div> : f.note && f.note !== "Your selection" ? <div className="text-muted-foreground">{f.note}</div> : null}
                          {f.outcome !== "verified" && f.options?.length ? (
                            <details>
                              <summary>Available options ({f.options.length}{f.optionsPartial ? "+" : ""})</summary>
                              <ul className="list-disc pl-5">{f.options.slice(0, 60).map((o) => <li key={o}>{o}</li>)}</ul>
                            </details>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {questions.length > 0 && (
              <div className="flex flex-col gap-3 rounded border p-3" data-testid="questions">
                <p className="font-medium">Missing answers ({requiredOpen.length} required still open)</p>
                <p className="text-muted-foreground">
                  Choose from the form&apos;s real options. Suggestions are only applied when you pick them. EEO and consent questions are filled only with an answer you choose here.
                </p>
                {questions.map((f) => {
                  const kind = answerControl(f);
                  const value = answers[f.label] ?? "";
                  const set = (v: string) => setAnswers({ ...answers, [f.label]: v });
                  const id = `a-${f.step}-${f.id}`;
                  return (
                    <div key={id} className="flex flex-col gap-1">
                      <Label htmlFor={id}>{f.label}{f.required ? " *" : ""}</Label>
                      {kind === "select" && (
                        <select id={id} className="bg-background rounded border p-2" value={value} onChange={(e) => set(e.target.value)}>
                          <option value="">— choose —</option>
                          {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      )}
                      {kind === "search" && (
                        <>
                          <Input id={id} list={`${id}-list`} value={value} placeholder="Type to search the form's list" onChange={(e) => set(e.target.value)} />
                          <datalist id={`${id}-list`}>{(f.options ?? []).map((o) => <option key={o} value={o} />)}</datalist>
                        </>
                      )}
                      {kind === "checkbox" && (
                        <label className="flex items-center gap-2"><input id={id} type="checkbox" checked={/^yes$/i.test(value)} onChange={(e) => set(e.target.checked ? "Yes" : "")} /> Yes (I tick this myself)</label>
                      )}
                      {kind === "textarea" && <textarea id={id} className="bg-background rounded border p-2" rows={3} value={value} onChange={(e) => set(e.target.value)} />}
                      {kind === "text" && <Input id={id} value={value} onChange={(e) => set(e.target.value)} />}
                      {f.suggestions && f.suggestions.length > 0 && f.outcome !== "verified" && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-muted-foreground">{f.suggestedBy === "ai" ? "AI suggestion" : "Suggested"} (confirm by choosing):</span>
                          {f.suggestions.slice(0, 6).map((o) => (
                            <Button key={o} type="button" size="sm" variant={value === o ? "default" : "outline"} onClick={() => set(o)}>{o}</Button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div>
                  <Button onClick={run} disabled={busy}>{busy ? "Re-filling in the cloud…" : "Apply my answers and re-run"}</Button>
                </div>
              </div>
            )}

            <details><summary>Execution log</summary><ul className="list-disc pl-5">{review.events.map((e, i) => <li key={i} className="break-all">{e}</li>)}</ul></details>
            {review.blockedEgress.length > 0 && <details><summary>Blocked requests ({review.blockedEgress.length})</summary><ul className="list-disc pl-5">{review.blockedEgress.map((u) => <li key={u} className="break-all">{u}</li>)}</ul></details>}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="Filled application (cloud screenshot)" className="w-full rounded border" data-testid="screenshot" src={`data:image/jpeg;base64,${review.screenshotJpegBase64}`} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
