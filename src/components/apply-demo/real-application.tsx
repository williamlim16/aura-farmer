"use client";

import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import type { CandidateProfile } from "~/lib/profile/schema";
import { answerableFields, answerControl, confidenceLabel, savedAnswersFrom, statusOf, type ReportField } from "./answers";

type Field = ReportField;
type Evidence = {
  app: { ats: string; postingUrl: string; applyUrl: string; via: string };
  runtime: { executor: string; chromiumVersion: string; region: string | null; durationMs: number; providers: string[] };
  report: { fields: Field[]; metrics: { verified: number; fields: number; required: number; requiredVerified: number; needsHuman: number; errors: number; mismatches: number }; blockedSubmits: { inPage: number; network: number } };
  blockedEgress: string[];
  screenshotJpegBase64: string;
  events: string[];
};
type Review = Evidence & { reviewToken: string };
type Outcome =
  | { status: "confirmed"; confirmation: string; finalUrl: string }
  | { status: "not_submitted"; reason: string; differences?: string[] }
  | { status: "blocked"; reason: string; finalUrl: string }
  | { status: "uncertain"; reason: string; finalUrl: string };
type Submitted = Evidence & { outcome: Outcome; submitRequests: string[] };

const CONTACT = [
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
type ContactKey = (typeof CONTACT)[number][0];

const TONE: Record<string, string> = { ok: "bg-green-100 text-green-900", warn: "bg-amber-100 text-amber-900", bad: "bg-red-100 text-red-900", idle: "bg-gray-100 text-gray-800" };

async function post<T>(path: string, fd: FormData): Promise<T> {
  const res = await fetch(path, { method: "POST", body: fd });
  const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export function RealApplication({ token }: { token: string }) {
  const [postingUrl, setPostingUrl] = useState("");
  const [resume, setResume] = useState<File | null>(null);
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [contact, setContact] = useState<Record<ContactKey, string>>({ fullName: "", firstName: "", lastName: "", email: "", phone: "", location: "", linkedin: "", github: "", website: "" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [review, setReview] = useState<Review | null>(null);
  const [reviewedProfileJson, setReviewedProfileJson] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const base = () => {
    const fd = new FormData();
    fd.set("token", token);
    if (resume) fd.set("resume", resume);
    return fd;
  };

  async function parse(file: File) {
    setResume(file);
    setProfile(null);
    setReview(null);
    setSubmitted(null);
    setError(null);
    setBusy("parse");
    try {
      const fd = new FormData();
      fd.set("token", token);
      fd.set("resume", file);
      const r = await post<{ profile: CandidateProfile }>("/api/apply-demo/real/parse", fd);
      setProfile(r.profile);
      const c = r.profile.contact;
      setContact({ fullName: c.fullName?.value ?? "", firstName: c.firstName?.value ?? "", lastName: c.lastName?.value ?? "", email: c.email?.value ?? "", phone: c.phone?.value ?? "", location: c.location?.value ?? "", linkedin: c.linkedin?.value ?? "", github: c.github?.value ?? "", website: c.website?.value ?? "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** Profile = parsed resume + the user's corrections + the user's explicit answers. Nothing else. */
  function finalProfile(): CandidateProfile {
    const p = structuredClone(profile!);
    const c: Record<string, { value: string; source: "user" | "parsed" | "llm"; confidence: number } | undefined> = { ...p.contact };
    for (const [k] of CONTACT) {
      const v = contact[k].trim();
      if (!v) delete c[k];
      else if (c[k]?.value !== v) c[k] = { value: v, source: "user", confidence: 1 };
    }
    p.contact = c;
    p.preferences = { ...(p.preferences ?? {}), savedAnswers: savedAnswersFrom(answers) };
    return p;
  }

  async function runReview() {
    setError(null);
    setSubmitted(null);
    setApproved(false);
    setBusy("review");
    try {
      const p = JSON.stringify(finalProfile());
      const fd = base();
      fd.set("postingUrl", postingUrl);
      fd.set("profile", p);
      const r = await post<Review>("/api/apply-demo/real/review", fd);
      setReview(r);
      setReviewedProfileJson(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function confirmSubmit() {
    if (!review || !reviewedProfileJson) return;
    setError(null);
    setBusy("submit");
    try {
      const fd = base();
      fd.set("profile", reviewedProfileJson);
      fd.set("reviewToken", review.reviewToken);
      fd.set("confirm", "SUBMIT");
      setSubmitted(await post<Submitted>("/api/apply-demo/real/submit", fd));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const fields = review?.report.fields ?? [];
  const questions = answerableFields(fields, answers);
  const open = fields.filter((f) => f.outcome !== "verified" && f.label && f.control !== "file" && !(f.outcome === "skipped" && !f.required));
  const requiredOpen = fields.filter((f) => f.required && f.outcome !== "verified" && f.label && !(f.control === "file" && f.outcome === "skipped"));
  const answersChanged = review && reviewedProfileJson !== JSON.stringify(profile ? finalProfile() : null);
  const canSubmit = !!review && requiredOpen.length === 0 && approved && !answersChanged && !submitted;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>1. Job posting and your resume</CardTitle>
          <CardDescription>
            Paste a public Greenhouse or Lever job link (or a company careers page that links to one). Your resume is parsed in memory and never stored. Only facts from your resume and answers you type are used.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="posting-url">Job posting URL</Label>
            <Input id="posting-url" placeholder="https://job-boards.greenhouse.io/<company>/jobs/<id>" value={postingUrl} onChange={(e) => setPostingUrl(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="resume">Your resume (PDF or DOCX, under 4 MB)</Label>
            <input id="resume" type="file" accept=".pdf,.docx" onChange={(e) => e.target.files?.[0] && void parse(e.target.files[0])} />
            {busy === "parse" && <p className="text-sm">Reading your resume…</p>}
          </div>
        </CardContent>
      </Card>

      {profile && (
        <Card>
          <CardHeader>
            <CardTitle>2. Check your details</CardTitle>
            <CardDescription>
              Parsed from your resume: {profile.experience.length} roles, {profile.education.length} education entries, {profile.skills.length} skills. Correct anything wrong; clear a field to leave it out.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {CONTACT.map(([k, label]) => (
              <div key={k} className="flex flex-col gap-1">
                <Label htmlFor={`rc-${k}`}>{label}</Label>
                <Input id={`rc-${k}`} value={contact[k]} onChange={(e) => setContact({ ...contact, [k]: e.target.value })} />
              </div>
            ))}
            <div className="sm:col-span-2">
              <Button onClick={runReview} disabled={!!busy || !postingUrl || !resume}>
                {busy === "review" ? "Filling the real application in the cloud… (up to a minute)" : review ? "Re-run with my answers" : "Fill application (review only, nothing is sent)"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      {review && (
        <Card>
          <CardHeader>
            <CardTitle>3. Review the filled application</CardTitle>
            <CardDescription>
              {review.app.applyUrl} ({review.app.ats}) · filled by {review.runtime.executor}, Chromium {review.runtime.chromiumVersion}
              {review.runtime.region ? `, ${review.runtime.region}` : ""} in {(review.runtime.durationMs / 1000).toFixed(1)}s · application not submitted (like any browser, the employer&apos;s page stores the attached resume file; no application exists until you confirm)
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p>
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
                        <td className="p-1 break-words">{f.control === "file" ? "—" : (typed ?? f.answer ?? <span className="text-muted-foreground">from your resume</span>)}</td>
                        <td className="p-1 break-all">{f.selected ?? (f.value === undefined || f.value === "" ? (f.control === "file" && f.outcome === "verified" ? "file attached" : "—") : String(f.value))}</td>
                        <td className="p-1"><span className={`rounded px-1 ${TONE[st.tone]}`}>{st.label}</span>{conf ? <span className="text-muted-foreground"> · {conf}</span> : null}</td>
                        <td className="p-1">
                          {f.outcome !== "verified" && f.reason ? <div>{f.reason}</div> : f.note && f.note !== "Your selection" ? <div className="text-muted-foreground">{f.note}</div> : null}
                          {f.outcome !== "verified" && f.options?.length ? (
                            <details>
                              <summary>Available options ({f.options.length}{f.optionsPartial ? "+" : ""})</summary>
                              <ul className="list-disc pl-5">{f.options.slice(0, 60).map((o) => <li key={o}>{o}</li>)}</ul>
                              {f.optionsPartial && <p className="text-muted-foreground">Partial list: the form searches the rest as you type.</p>}
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
              <div className="flex flex-col gap-3 rounded border p-3">
                <p className="font-medium">Your answers ({requiredOpen.length} required still open)</p>
                <p className="text-muted-foreground">
                  Choose from the form&apos;s real options (no need to guess the wording). Long lists such as schools search the form&apos;s own list as you type. Suggestions are only applied when you pick them. EEO and consent questions are filled only with an answer you choose here. Your answers are kept between runs.
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
                        <select id={id} className="rounded border p-2" value={value} onChange={(e) => set(e.target.value)}>
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
                      {kind === "textarea" && <textarea id={id} className="rounded border p-2" rows={3} value={value} onChange={(e) => set(e.target.value)} />}
                      {kind === "text" && <Input id={id} value={value} onChange={(e) => set(e.target.value)} />}
                      {f.suggestions && f.suggestions.length > 0 && f.outcome !== "verified" && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-muted-foreground">{f.suggestedBy === "ai" ? "AI suggestion" : "Suggested"} from the form&apos;s options (confirm by choosing):</span>
                          {f.suggestions.slice(0, 6).map((o) => (
                            <Button key={o} type="button" size="sm" variant={value === o ? "default" : "outline"} onClick={() => set(o)}>{o}</Button>
                          ))}
                        </div>
                      )}
                      {f.outcome !== "verified" && f.reason && value.trim() !== "" && <p className="text-amber-800">{f.reason}</p>}
                    </div>
                  );
                })}
                <div>
                  <Button onClick={runReview} disabled={!!busy}>{busy === "review" ? "Re-filling in the cloud…" : "Apply my answers and re-run"}</Button>
                </div>
              </div>
            )}

            <details><summary>Execution log</summary><ul className="list-disc pl-5">{review.events.map((e, i) => <li key={i} className="break-all">{e}</li>)}</ul></details>
            {review.blockedEgress.length > 0 && <details><summary>Blocked requests ({review.blockedEgress.length})</summary><ul className="list-disc pl-5">{review.blockedEgress.map((u) => <li key={u} className="break-all">{u}</li>)}</ul></details>}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="Filled application (cloud screenshot)" className="w-full rounded border" src={`data:image/jpeg;base64,${review.screenshotJpegBase64}`} />
          </CardContent>
        </Card>
      )}

      {review && !submitted && (
        <Card className="border-red-300">
          <CardHeader>
            <CardTitle>4. Final review: submit to the employer?</CardTitle>
            <CardDescription>
              This sends a real application to {new URL(review.app.applyUrl).hostname}{new URL(review.app.applyUrl).pathname}. The form is re-filled and every value above is re-verified first; if anything differs, nothing is sent.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {requiredOpen.length > 0 && <p className="text-red-700">Answer the {requiredOpen.length} required question(s) above and re-run before submitting.</p>}
            {answersChanged && <p className="text-red-700">Your details or answers changed since this review. Re-run the review first.</p>}
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} data-testid="approve-submit" />
              <span>I reviewed every answer and the screenshot above, the information is true, and I want to submit this one application.</span>
            </label>
            <div>
              <Button variant="destructive" onClick={confirmSubmit} disabled={!canSubmit || !!busy} data-testid="confirm-submit">
                {busy === "submit" ? "Re-verifying and submitting… (up to 2 minutes)" : "Confirm Submit"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {submitted && (
        <Card className={submitted.outcome.status === "confirmed" ? "border-green-500" : "border-amber-500"}>
          <CardHeader>
            <CardTitle>
              {submitted.outcome.status === "confirmed" && "Submitted: the employer confirmed receipt"}
              {submitted.outcome.status === "not_submitted" && "Not submitted"}
              {submitted.outcome.status === "blocked" && "Blocked by the site (not confirmed)"}
              {submitted.outcome.status === "uncertain" && "Uncertain: no confirmation seen"}
            </CardTitle>
            <CardDescription>
              {"confirmation" in submitted.outcome ? `Confirmation: “${submitted.outcome.confirmation}”` : submitted.outcome.reason}
              {"finalUrl" in submitted.outcome ? ` · final page ${submitted.outcome.finalUrl}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {submitted.outcome.status === "not_submitted" && submitted.outcome.differences && <ul className="list-disc pl-5">{submitted.outcome.differences.map((d) => <li key={d}>{d}</li>)}</ul>}
            {submitted.submitRequests.length > 0 && <details><summary>Requests sent after the submit click ({submitted.submitRequests.length})</summary><ul className="list-disc pl-5">{submitted.submitRequests.map((u, i) => <li key={i} className="break-all">{u}</li>)}</ul></details>}
            <details><summary>Execution log</summary><ul className="list-disc pl-5">{submitted.events.map((e, i) => <li key={i} className="break-all">{e}</li>)}</ul></details>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="Page after submit (cloud screenshot)" className="w-full rounded border" src={`data:image/jpeg;base64,${submitted.screenshotJpegBase64}`} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
