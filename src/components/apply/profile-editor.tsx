"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import { Badge } from "~/components/apply/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import type { ProfileReview, ReviewContactField } from "~/lib/profile/review";
import { apiFetch } from "~/lib/client/api";
import { RESUME_ERROR_MESSAGES, validateResumeMeta } from "~/lib/resume/validate";

const CONTACT_LABELS: Record<keyof ProfileReview["contact"], string> = {
  fullName: "Full name",
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  location: "Location",
  linkedin: "LinkedIn URL",
  github: "GitHub URL",
  website: "Website",
};

type Pref = keyof ProfileReview["preferences"];
const YN: Pref[] = ["workAuthorized", "needsSponsorship", "willingToRelocate"];
const PREF_LABELS: Record<Pref, string> = {
  workAuthCountry: "Work authorisation: country",
  workAuthorized: "Authorised to work there?",
  needsSponsorship: "Need visa sponsorship?",
  salaryExpectation: "Salary expectation",
  noticePeriod: "Notice period",
  earliestStartDate: "Earliest start date",
  willingToRelocate: "Willing to relocate?",
  referralSource: "How you usually find jobs",
};

function SourceBadge({ f }: { f: ReviewContactField }) {
  if (f.source === "missing") return <Badge tone="danger">not found</Badge>;
  if (f.source === "user") return <Badge tone="success">confirmed by you</Badge>;
  return <Badge tone={f.confidence < 0.8 ? "warning" : "progress"}>{`${f.source === "llm" ? "AI" : "parsed"} ${Math.round(f.confidence * 100)}%`}</Badge>;
}

interface Props {
  initial: { review: ProfileReview; version: number; resume: { filename: string; createdAt: string } | null } | null;
}

export function ProfileEditor({ initial }: Props) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [missing, setMissing] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const formKey = data ? `${data.version}` : "none";

  async function upload(e: FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    setUploadError("");
    const check = validateResumeMeta(file);
    if (!check.ok || !file) return setUploadError(RESUME_ERROR_MESSAGES[check.ok ? "missing" : check.error]);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("resume", file);
      const r = await apiFetch<{ review: ProfileReview; version: number; missing?: string[]; resume?: { filename: string; createdAt: string } }>("/api/resume/upload", { method: "POST", body: fd });
      if (!r.ok) throw new Error(r.error);
      const body = r.data;
      setData({ review: body.review, version: body.version, resume: body.resume ?? null });
      setMissing(body.missing ?? []);
      setStatus("Resume processed. Review the details below.");
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data) return;
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => { const v = fd.get(k); return typeof v === "string" ? v : ""; };
    const rows = (prefix: string, keys: string[]) => {
      const n = Number(get(`${prefix}.count`));
      return Array.from({ length: n }, (_, i) => Object.fromEntries(keys.map((k) => [k, get(`${prefix}.${i}.${k}`)]))).filter((r) => Object.values(r).some(Boolean));
    };
    const payload = {
      expectedVersion: data.version,
      contact: Object.fromEntries(Object.keys(CONTACT_LABELS).map((k) => [k, get(`contact.${k}`)])),
      summary: get("summary"),
      totalYearsExperience: get("totalYearsExperience"),
      skills: get("skills"),
      experience: rows("experience", ["title", "company", "start", "end"]),
      education: rows("education", ["degree", "institution", "start", "end"]),
      preferences: Object.fromEntries((Object.keys(PREF_LABELS) as Pref[]).map((k) => [k, get(`pref.${k}`)])),
    };
    setSaving(true);
    setErrors({});
    setStatus("");
    try {
      const r = await apiFetch<{ review: ProfileReview; version: number }>("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok && r.status === 422 && r.data.errors) {
        setErrors(r.data.errors as Record<string, string>);
        setStatus("Please fix the highlighted fields.");
        return;
      }
      if (!r.ok && r.code === "conflict") {
        setStatus("This profile was changed in another tab. Reload the page to get the latest version.");
        return;
      }
      if (!r.ok) throw new Error(r.error);
      setData({ ...data, review: r.data.review, version: r.data.version });
      setStatus("Saved.");
      router.refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const r = data?.review;
  const fieldError = (k: string) => errors[k] && <p className="text-destructive text-xs" role="alert">{errors[k]}</p>;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Resume</CardTitle>
          <CardDescription>
            {data?.resume ? `Current: ${data.resume.filename}. Uploading a new resume refreshes extracted details but keeps your preferences and confirmed fields.` : "PDF or DOCX, up to 5 MB. Please use synthetic data while we are testing."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={upload} className="flex flex-wrap items-center gap-3">
            <Label htmlFor="resume-file" className="sr-only">Resume file</Label>
            <Input id="resume-file" ref={fileRef} type="file" accept=".pdf,.docx" className="max-w-sm" disabled={uploading} />
            <Button type="submit" disabled={uploading}>{uploading ? "Processing…" : data ? "Replace resume" : "Upload and extract"}</Button>
          </form>
          {uploadError && <p role="alert" className="text-destructive mt-3 text-sm">{uploadError}</p>}
        </CardContent>
      </Card>

      {r && (
        <form key={formKey} onSubmit={save} className="flex flex-col gap-6" aria-label="Profile">
          {missing.length > 0 && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
              Not found in your resume: {missing.join(", ")}. Add them below if you have them.
            </p>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Contact details</CardTitle>
              <CardDescription>Badges show where each value came from. Anything you change is marked as confirmed by you.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(Object.keys(CONTACT_LABELS) as (keyof ProfileReview["contact"])[]).map((k) => (
                <div key={k} className="flex flex-col gap-1.5">
                  <Label htmlFor={`contact.${k}`} className="flex flex-wrap gap-2">{CONTACT_LABELS[k]} <SourceBadge f={r.contact[k]} /></Label>
                  <Input id={`contact.${k}`} name={`contact.${k}`} defaultValue={r.contact[k].value} aria-invalid={!!errors[k]} />
                  {fieldError(k)}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Background</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="summary">Summary</Label>
                <textarea id="summary" name="summary" defaultValue={r.summary} rows={3} className="border-input rounded-md border bg-transparent px-3 py-2 text-sm" />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="totalYearsExperience">Total years of experience</Label>
                  <Input id="totalYearsExperience" name="totalYearsExperience" inputMode="numeric" defaultValue={r.totalYearsExperience} aria-invalid={!!errors.totalYearsExperience} />
                  {fieldError("totalYearsExperience")}
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label htmlFor="skills">Skills (comma-separated)</Label>
                  <Input id="skills" name="skills" defaultValue={r.skills} />
                </div>
              </div>
              <RowsEditor prefix="experience" title="Experience" keys={["title", "company", "start", "end"]} labels={["Title", "Company", "Start", "End"]} initial={r.experience} />
              <RowsEditor prefix="education" title="Education" keys={["degree", "institution", "start", "end"]} labels={["Degree", "Institution", "Start", "End"]} initial={r.education} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Application preferences</CardTitle>
              <CardDescription>Never guessed from your resume. Questions about these are left for you unless you fill them in here.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(Object.keys(PREF_LABELS) as Pref[]).map((k) => (
                <div key={k} className="flex flex-col gap-1.5">
                  <Label htmlFor={`pref.${k}`}>{PREF_LABELS[k]}</Label>
                  {YN.includes(k) ? (
                    <select id={`pref.${k}`} name={`pref.${k}`} defaultValue={r.preferences[k]} className="border-input h-9 rounded-md border bg-transparent px-3 text-sm">
                      <option value="">Not stated</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  ) : (
                    <Input id={`pref.${k}`} name={`pref.${k}`} defaultValue={r.preferences[k]} aria-invalid={!!errors[k]} />
                  )}
                  {fieldError(k)}
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save profile"}</Button>
            <span role="status" className="text-muted-foreground text-sm">{status}</span>
          </div>
        </form>
      )}
      {!r && status && <p role="status" className="text-sm">{status}</p>}
    </div>
  );
}

function RowsEditor({ prefix, title, keys, labels, initial }: { prefix: string; title: string; keys: string[]; labels: string[]; initial: Record<string, string>[] }) {
  const [rows, setRows] = useState(() => initial.map((r) => ({ id: crypto.randomUUID(), ...r })));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">{title}</legend>
      <input type="hidden" name={`${prefix}.count`} value={rows.length} />
      {rows.map((row, i) => (
        <div key={row.id} className="grid items-end gap-2 sm:grid-cols-[2fr_2fr_1fr_1fr_auto]">
          {keys.map((k, j) => (
            <div key={k} className="flex flex-col gap-1">
              <Label htmlFor={`${prefix}.${i}.${k}`} className="text-xs">{labels[j]}</Label>
              <Input id={`${prefix}.${i}.${k}`} name={`${prefix}.${i}.${k}`} defaultValue={(row as Record<string, string>)[k] ?? ""} />
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setRows(rows.filter((x) => x.id !== row.id))} aria-label={`Remove ${title.toLowerCase()} ${i + 1}`}>
            Remove
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, { id: crypto.randomUUID() }])}>+ Add {title.toLowerCase()}</Button>
      </div>
    </fieldset>
  );
}
