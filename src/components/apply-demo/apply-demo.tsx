"use client";

import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

type Field = { id: string; label: string; kind: string; required: boolean; tier: string; outcome: string; value?: string | boolean; reason?: string; step: number };
type Result = {
  target: { key: string; url: string; title: string };
  runtime: { executor: string; chromiumVersion: string; region: string | null; durationMs: number; providers: string[] };
  report: { fields: Field[]; formLocation: string; metrics: { verified: number; fields: number; required: number; requiredVerified: number; needsHuman: number; errors: number; mismatches: number }; blockedSubmits: { inPage: number; network: number }; steps: { step: number; advanced: boolean; stoppedBecause?: string }[] };
  blockedEgress: string[];
  screenshotPngBase64: string;
  events: string[];
};

const OUTCOME_STYLE: Record<string, string> = {
  verified: "bg-green-100 text-green-900",
  mismatch: "bg-amber-100 text-amber-900",
  error: "bg-red-100 text-red-900",
};

export function ApplyDemo({ forms, personas, token }: { forms: { key: string; label: string; description: string }[]; personas: { key: string; label: string }[]; token: string }) {
  const [formKey, setFormKey] = useState(forms.find((f) => f.key === "greenhouse-like")?.key ?? forms[0]?.key ?? "");
  const [persona, setPersona] = useState(personas[0]?.key ?? "");
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
      const res = await fetch("/api/apply-demo/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, formKey, persona }) });
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

  const m = result?.report.metrics;
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>1. Application form and candidate</CardTitle>
          <CardDescription>Synthetic test forms only, served inside the cloud function. Candidates are fictional; a resume PDF is generated for them.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Test form
            <select className="rounded border p-2" value={formKey} onChange={(e) => setFormKey(e.target.value)} data-testid="demo-form">
              {forms.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
            <span className="text-muted-foreground">{forms.find((f) => f.key === formKey)?.description}</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Fictional candidate
            <select className="rounded border p-2" value={persona} onChange={(e) => setPersona(e.target.value)} data-testid="demo-persona">
              {personas.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          </label>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={run} disabled={busy}>{busy ? `Running in the cloud… ${elapsed}s` : "Run Autofill"}</Button>
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
