"use client";

import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";

type Field = { id: string; label: string; kind: string; required: boolean; tier: string; outcome: string; value?: string | boolean; reason?: string; step: number };
type Result = {
  target: { kind: string; url: string; title: string };
  runtime: { executor: string; chromiumVersion: string; region: string | null; durationMs: number; providers: string[] };
  report: { fields: Field[]; formLocation: string; metrics: { verified: number; fields: number; required: number; requiredVerified: number; needsHuman: number; errors: number; mismatches: number }; blockedSubmits: { inPage: number; network: number }; steps: { step: number; advanced: boolean; stoppedBecause?: string }[] };
  blockedEgress: string[];
  screenshotPngBase64: string;
  events: string[];
};

/** Fictional candidate. Not a real person. */
const SAMPLE = {
  fullName: "Alex Rivera",
  email: "alex.rivera@example.com",
  phone: "+61 400 000 123",
  location: "Sydney, NSW, Australia",
  linkedin: "https://www.linkedin.com/in/alex-rivera-example",
  github: "https://github.com/alex-rivera-example",
  website: "",
  currentTitle: "Senior Software Engineer",
  currentCompany: "Example Systems",
  skills: "TypeScript, React, Node.js, PostgreSQL, Playwright, AWS",
  summary: "Software engineer with 7 years building web platforms in TypeScript and Node.js.",
  workAuthCountry: "Australia",
  salaryExpectation: "",
  noticePeriod: "4 weeks",
};

const OUTCOME_STYLE: Record<string, string> = {
  verified: "bg-green-100 text-green-900",
  mismatch: "bg-amber-100 text-amber-900",
  error: "bg-red-100 text-red-900",
};

export function ApplyDemo({ forms, atsHosts }: { forms: { key: string; label: string; description: string }[]; atsHosts: string[] }) {
  const [targetKind, setTargetKind] = useState<"synthetic" | "ats">("synthetic");
  const [formKey, setFormKey] = useState(forms[0]?.key ?? "");
  const [url, setUrl] = useState("");
  const [c, setC] = useState(SAMPLE);
  const [authorised, setAuthorised] = useState(true);
  const [needsSponsorship, setNeedsSponsorship] = useState(false);
  const [resume, setResume] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [elapsed, setElapsed] = useState(0);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    const t0 = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    try {
      const fd = new FormData();
      fd.set("targetKind", targetKind);
      fd.set("formKey", formKey);
      fd.set("url", url);
      fd.set("candidate", JSON.stringify({ ...c, authorised, needsSponsorship }));
      if (resume) fd.set("resume", resume);
      const res = await fetch("/api/apply-demo/run", { method: "POST", body: fd, redirect: "manual" });
      if (res.type === "opaqueredirect" || res.status === 401) throw new Error("Your session expired. Sign in again.");
      const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as Result & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      clearInterval(timer);
      setBusy(false);
    }
  }

  const field = (k: keyof typeof SAMPLE, label: string) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`c-${k}`}>{label}</Label>
      <Input id={`c-${k}`} value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} />
    </div>
  );

  const m = result?.report.metrics;
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>1. Application form</CardTitle>
          <CardDescription>Start with a synthetic form. Real ATS pages are filled for review only and never submitted.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="tk" checked={targetKind === "synthetic"} onChange={() => setTargetKind("synthetic")} /> Synthetic test form (served inside the cloud function)
          </label>
          {targetKind === "synthetic" && (
            <select className="rounded border p-2 text-sm" value={formKey} onChange={(e) => setFormKey(e.target.value)} aria-label="Test form">
              {forms.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="tk" checked={targetKind === "ats"} onChange={() => setTargetKind("ats")} /> Real application URL ({atsHosts.join(", ")})
          </label>
          {targetKind === "ats" && <Input placeholder="https://job-boards.greenhouse.io/<company>/jobs/<id>" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Application URL" />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Candidate (fictional sample prefilled)</CardTitle>
          <CardDescription>Used only for this run; nothing is saved. Optionally attach a resume (PDF/DOCX) to parse and upload to the form.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {field("fullName", "Full name")}
          {field("email", "Email")}
          {field("phone", "Phone")}
          {field("location", "Location")}
          {field("linkedin", "LinkedIn URL")}
          {field("github", "GitHub URL")}
          {field("currentTitle", "Current title")}
          {field("currentCompany", "Current company")}
          {field("workAuthCountry", "Work authorisation country")}
          {field("noticePeriod", "Notice period")}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={authorised} onChange={(e) => setAuthorised(e.target.checked)} /> Authorised to work there</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={needsSponsorship} onChange={(e) => setNeedsSponsorship(e.target.checked)} /> Needs visa sponsorship</label>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="c-skills">Skills (comma separated)</Label>
            <Input id="c-skills" value={c.skills} onChange={(e) => setC({ ...c, skills: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="c-summary">Summary</Label>
            <Textarea id="c-summary" value={c.summary} onChange={(e) => setC({ ...c, summary: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="c-resume">Resume (optional)</Label>
            <input id="c-resume" type="file" accept=".pdf,.docx" onChange={(e) => setResume(e.target.files?.[0] ?? null)} />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={run} disabled={busy || (targetKind === "ats" && !url)}>{busy ? `Running in the cloud… ${elapsed}s` : "Run Autofill"}</Button>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </div>

      {result && m && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>3. Result</CardTitle>
              <CardDescription>
                {result.target.title} · executed by {result.runtime.executor} (Chromium {result.runtime.chromiumVersion}{result.runtime.region ? `, region ${result.runtime.region}` : ""}) in {(result.runtime.durationMs / 1000).toFixed(1)}s · tiers: {result.runtime.providers.join(" → ")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <p data-testid="demo-summary">
                <strong>{m.verified}</strong> of {m.fields} fields filled and read back · {m.requiredVerified}/{m.required} required · {m.needsHuman} need your input · {m.errors + m.mismatches} problems · submit attempts blocked: {result.report.blockedSubmits.inPage + result.report.blockedSubmits.network} · nothing was submitted.
              </p>
              {result.report.steps.filter((s) => s.stoppedBecause).map((s) => <p key={s.step} className="text-muted-foreground">Step {s.step}: {s.stoppedBecause}</p>)}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead><tr className="border-b"><th className="p-1">Field</th><th className="p-1">Value filled</th><th className="p-1">Decided by</th><th className="p-1">Read-back</th></tr></thead>
                  <tbody>
                    {result.report.fields.map((f) => (
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
              {result.blockedEgress.length > 0 && <details><summary>Requests blocked by the egress allowlist ({result.blockedEgress.length})</summary><ul className="list-disc pl-5">{result.blockedEgress.map((u) => <li key={u} className="break-all">{u}</li>)}</ul></details>}
              <details><summary>Execution log</summary><ul className="list-disc pl-5">{result.events.map((e, i) => <li key={i} className="break-all">{e}</li>)}</ul></details>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Screenshot of the filled form (taken in the cloud browser)</CardTitle></CardHeader>
            <CardContent>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="Filled form screenshot" className="w-full rounded border" src={`data:image/png;base64,${result.screenshotPngBase64}`} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
