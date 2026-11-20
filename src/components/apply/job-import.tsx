"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { apiFetch } from "~/lib/client/api";
import type { PostingDraft } from "~/lib/postings/types";

const area = "border-input min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm";
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function JobImport() {
  const router = useRouter();
  const [mode, setMode] = useState<"url" | "manual">("url");
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<PostingDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function preview(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setDraft(null);
    const r = await apiFetch<{ draft: PostingDraft }>("/api/postings/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDraft(r.data.draft);
  }

  async function save(body: unknown) {
    setBusy(true);
    setError("");
    const r = await apiFetch<{ posting: { id: string } }>("/api/postings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.push(`/apply/jobs/${r.data.posting.id}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a job</CardTitle>
        <CardDescription>Paste a Greenhouse, Lever or Ashby job link, or paste the job description yourself.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div role="tablist" aria-label="How to add the job" className="flex gap-2">
          <Button type="button" role="tab" aria-selected={mode === "url"} variant={mode === "url" ? "default" : "outline"} size="sm" onClick={() => setMode("url")}>From a link</Button>
          <Button type="button" role="tab" aria-selected={mode === "manual"} variant={mode === "manual" ? "default" : "outline"} size="sm" onClick={() => setMode("manual")}>Paste description</Button>
        </div>

        {mode === "url" && (
          <form onSubmit={preview} className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-64 flex-1 flex-col gap-1.5">
              <Label htmlFor="job-link">Job posting link</Label>
              <Input id="job-link" type="url" required placeholder="https://boards.greenhouse.io/company/jobs/123" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <Button type="submit" disabled={busy}>{busy ? "Reading…" : "Read posting"}</Button>
          </form>
        )}

        {mode === "url" && draft && (
          <form
            className="flex flex-col gap-3 rounded-md border p-4"
            aria-label="Review imported posting"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const get = (k: string) => { const v = fd.get(k); return typeof v === "string" ? v : ""; };
              void save({ kind: "imported", draft: { source: draft.source, sourceUrl: draft.sourceUrl, externalId: draft.externalId, description: draft.description, title: get("title"), company: get("company"), location: get("location"), requirements: { required: lines(get("required")), preferred: lines(get("preferred")) } } });
            }}
          >
            <p className="text-muted-foreground text-xs">Read from the public {draft.source} API. Check and correct before saving.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm">Title<Input name="title" defaultValue={draft.title} required /></label>
              <label className="flex flex-col gap-1 text-sm">Company<Input name="company" defaultValue={draft.company} required /></label>
              <label className="flex flex-col gap-1 text-sm">Location<Input name="location" defaultValue={draft.location} /></label>
            </div>
            <label className="flex flex-col gap-1 text-sm">Requirements (one per line)<textarea name="required" className={area} defaultValue={draft.requirements.required.join("\n")} /></label>
            <label className="flex flex-col gap-1 text-sm">Nice to have (one per line)<textarea name="preferred" className={area} defaultValue={draft.requirements.preferred.join("\n")} /></label>
            {draft.requirements.required.length === 0 && <p className="text-sm text-amber-700 dark:text-amber-300">No requirements were found automatically. Add the key ones above for a useful match.</p>}
            <details><summary className="cursor-pointer text-sm">Full description</summary><pre className="text-muted-foreground mt-2 max-h-64 overflow-auto text-xs whitespace-pre-wrap">{draft.description}</pre></details>
            <div><Button type="submit" disabled={busy}>Save to my jobs</Button></div>
          </form>
        )}

        {mode === "manual" && (
          <form
            className="flex flex-col gap-3"
            aria-label="Paste job description"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const get = (k: string) => { const v = fd.get(k); return typeof v === "string" ? v : ""; };
              void save({ kind: "manual", title: get("title"), company: get("company"), location: get("location"), description: get("description"), ...(get("url") ? { url: get("url") } : {}) });
            }}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm">Title<Input name="title" required /></label>
              <label className="flex flex-col gap-1 text-sm">Company<Input name="company" required /></label>
              <label className="flex flex-col gap-1 text-sm">Location<Input name="location" /></label>
            </div>
            <label className="flex flex-col gap-1 text-sm">Job description<textarea name="description" required minLength={40} className={`${area} min-h-48`} placeholder="Paste the whole posting, including the requirements section." /></label>
            <label className="flex flex-col gap-1 text-sm">Link (optional)<Input name="url" type="url" /></label>
            <div><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save job"}</Button></div>
          </form>
        )}
        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      </CardContent>
    </Card>
  );
}
