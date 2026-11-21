"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { APPLICATION_TARGETS, checkJobUrl } from "~/lib/applications/targets";
import { apiFetch } from "~/lib/client/api";

export function NewApplicationForm({ llm }: { llm: { available: boolean; label: string } }) {
  const router = useRouter();
  const [targetKey, setTargetKey] = useState(APPLICATION_TARGETS[0]!.key);
  const [useLlm, setUseLlm] = useState(false);
  const [jobUrl, setJobUrl] = useState("");
  const [urlNote, setUrlNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const target = APPLICATION_TARGETS.find((t) => t.key === targetKey)!;

  async function create(start: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await apiFetch<{ application: { id: string } }>("/api/applications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetKey, useLlm: llm.available && useLlm, start }) });
      if (!r.ok) throw new Error(r.error);
      router.push(`/apply/applications/${r.data.application.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the application.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Have a job link?</CardTitle>
          <CardDescription>We check the link, but filling real job sites is not enabled yet.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const c = checkJobUrl(jobUrl);
              setUrlNote(c.ok ? c.note : c.reason);
            }}
          >
            <div className="flex min-w-64 flex-1 flex-col gap-1.5">
              <Label htmlFor="job-url">Job application URL</Label>
              <Input id="job-url" type="url" placeholder="https://…" value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} />
            </div>
            <Button type="submit" variant="outline">Check link</Button>
          </form>
          {urlNote && <p role="status" className="text-muted-foreground mt-3 text-sm">{urlNote}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Choose a test job</CardTitle>
          <CardDescription>Synthetic application forms that run on a local, isolated browser. They cannot reach the internet.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">Test job</legend>
            {APPLICATION_TARGETS.map((t) => (
              <label key={t.key} className={`flex cursor-pointer gap-3 rounded-md border p-3 text-sm ${t.key === targetKey ? "border-primary ring-primary/30 ring-2" : ""}`}>
                <input type="radio" name="target" value={t.key} checked={t.key === targetKey} onChange={() => setTargetKey(t.key)} className="mt-1" />
                <span>
                  <span className="block font-medium">{t.title}</span>
                  <span className="text-muted-foreground block">{t.company}</span>
                  <span className="text-muted-foreground mt-1 block text-xs">{t.description}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <section aria-labelledby="reqs" className="rounded-md border p-4">
            <h2 id="reqs" className="text-sm font-semibold">Job requirements: {target.title}</h2>
            {target.requirements?.length ? (
              <ul className="text-muted-foreground mt-2 list-disc pl-5 text-sm">{target.requirements.map((r) => <li key={r}>{r}</li>)}</ul>
            ) : (
              <p className="text-muted-foreground mt-2 text-sm">This test form checks form-filling behaviour only.</p>
            )}
          </section>

          <label className={`flex items-start gap-2 text-sm ${llm.available ? "" : "opacity-60"}`}>
            <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} disabled={!llm.available} className="mt-1" />
            <span>
              Use an LLM for questions rules cannot answer (one batched call, drafts always flagged for your review).
              <span className="text-muted-foreground block text-xs">Provider: {llm.label}</span>
            </span>
          </label>

          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={() => void create(true)} disabled={busy}>{busy ? "Starting…" : "Prepare and start autofill"}</Button>
            <Button type="button" variant="outline" onClick={() => void create(false)} disabled={busy}>Prepare only</Button>
          </div>
          {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
