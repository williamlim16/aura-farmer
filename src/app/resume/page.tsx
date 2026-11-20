"use client";

// Ported from the local career-ops-web prototype (resume upload card), now using
// the shared validator and the team's shadcn components.

import { useState, type ChangeEvent } from "react";

import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { RESUME_ERROR_MESSAGES, validateResumeMeta } from "~/lib/resume/validate";

export default function ResumePage() {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadedPath, setUploadedPath] = useState("");

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setError("");
    setUploadedPath("");
    setFile(null);
    if (!selected) return;
    const check = validateResumeMeta(selected);
    if (!check.ok) {
      setError(RESUME_ERROR_MESSAGES[check.error]);
      return;
    }
    setFile(selected);
  }

  async function uploadResume() {
    if (!file || uploading) return;
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("resume", file);
      const response = await fetch("/api/resume/upload", { method: "POST", body: formData });
      const result = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        path?: string;
      };
      if (!response.ok || !result.success) throw new Error(result.error ?? "Upload failed.");
      setUploadedPath(result.path ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong during upload.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="bg-background text-foreground flex min-h-svh items-center justify-center p-6 md:p-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg font-medium">Upload your resume</CardTitle>
          <CardDescription>PDF or DOCX, maximum 5 MB.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label
            htmlFor="resume-upload"
            className="hover:bg-muted flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed p-8 text-center"
          >
            <span className="font-medium">Click to choose a file</span>
            <span className="text-muted-foreground mt-1 text-sm">PDF or Word document</span>
          </label>
          <input
            id="resume-upload"
            type="file"
            accept=".pdf,.docx"
            onChange={handleFileChange}
            disabled={uploading}
            className="sr-only"
          />
          {file && (
            <p className="text-sm">
              {file.name} · {(file.size / 1024).toFixed(1)} KB
            </p>
          )}
          {file && !uploadedPath && (
            <Button type="button" onClick={uploadResume} disabled={uploading}>
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          {uploadedPath && (
            <p role="status" className="text-sm text-green-600">
              Uploaded. Storage path: <span className="break-all">{uploadedPath}</span>
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
