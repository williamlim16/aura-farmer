"use client";

import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import type { CandidateProfile } from "~/lib/profile/schema";

type Field = { id: string; label: string; kind: string; control: string; required: boolean; tier: string; outcome: string; value?: string | boolean; reason?: string; step: number };
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

/** Must match normQ in ~/lib/apply/decision/rules (saved answers are keyed by normalised question text). */
const normQ = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

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

const OUTCOME_STYLE: Record<string, string> = { verified: "bg-green-100 text-green-900", mismatch: "bg-amber-100 text-amber-900", error: "bg-red-100 text-red-900" };

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
    const saved: Record<string, string> = {};
    for (const [label, v] of Object.entries(answers)) if (v.trim()) saved[normQ(label)] = v.trim();
    p.preferences = { ...(p.preferences ?? {}), savedAnswers: saved };
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
  const open = fields.filter((f) => f.outcome !== "verified" && f.label);
  const requiredOpen = open.filter((f) => f.required);
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
                  <tr className="border-b"><th className="p-1">Question</th><th className="p-1">Filled value</th><th className="p-1">Source</th><th className="p-1">Read-back</th></tr>
                </thead>
                <tbody>
                  {fields.map((f) => (
                    <tr key={`${f.step}-${f.id}`} className="border-b align-top">
                      <td className="p-1">{f.label || f.id}{f.required ? " *" : ""}</td>
                      <td className="p-1 break-all">{f.value === undefined ? <span className="text-muted-foreground">{f.reason ?? "—"}</span> : String(f.value)}</td>
                      <td className="p-1">{f.tier}</td>
                      <td className="p-1"><span className={`rounded px-1 ${OUTCOME_STYLE[f.outcome] ?? "bg-gray-100"}`}>{f.outcome.replace(/_/g, " ")}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {open.length > 0 && (
              <div className="flex flex-col gap-2 rounded border p-3">
                <p className="font-medium">Your answers for the remaining questions ({requiredOpen.length} required)</p>
                <p className="text-muted-foreground">Type exactly what you want submitted (for a dropdown, type the option text; for a checkbox, type Yes). Leave optional ones blank to skip. EEO and consent questions are only ever filled with your own typed answer.</p>
                {open.map((f) => (
                  <div key={`a-${f.step}-${f.id}`} className="flex flex-col gap-1">
                    <Label htmlFor={`a-${f.id}`}>{f.label}{f.required ? " *" : ""} <span className="text-muted-foreground">({f.reason ?? f.outcome})</span></Label>
                    <Input id={`a-${f.id}`} value={answers[f.label] ?? ""} onChange={(e) => setAnswers({ ...answers, [f.label]: e.target.value })} />
                  </div>
                ))}
                <div>
                  <Button variant="outline" onClick={runReview} disabled={!!busy}>{busy === "review" ? "Re-filling…" : "Re-run with my answers"}</Button>
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
