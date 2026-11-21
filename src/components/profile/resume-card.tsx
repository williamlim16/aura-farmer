"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";

import { deleteResumeAction, uploadResumeAction } from "~/app/profile/actions";
import { FormAlert } from "~/components/form-alert";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { cn } from "~/lib/utils";
import type { Resume } from "~/server/db/schema";

interface ResumeCardProps {
  initialResumes: Resume[];
  dbAvailable: boolean;
}

const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".pdf", ".doc", ".docx"];
const ACCEPTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function isSupportedResumeFile(file: File): boolean {
  const lowerName = file.name.trim().toLowerCase();
  const hasValidExtension = ACCEPTED_EXTENSIONS.some((ext) =>
    lowerName.endsWith(ext),
  );
  const rawType = file.type.trim().toLowerCase();

  if (!rawType || rawType === "application/octet-stream") {
    return hasValidExtension;
  }

  return ACCEPTED_MIME_TYPES.has(rawType);
}

function getFileTypeLabel(resume: Resume): string {
  const lowerName = resume.fileName.toLowerCase();
  if (lowerName.endsWith(".docx") || resume.mimeType.includes("wordprocessingml")) {
    return "DOCX";
  }
  if (lowerName.endsWith(".doc") || resume.mimeType === "application/msword") {
    return "DOC";
  }
  if (lowerName.endsWith(".pdf") || resume.mimeType.includes("pdf")) {
    return "PDF";
  }
  return "FILE";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function formatUploadDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function ResumeCard({ initialResumes, dbAvailable }: ResumeCardProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [resumes, setResumes] = useState<Resume[]>(initialResumes);
  const [isDragging, setIsDragging] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    variant: "success" | "error";
    message: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setResumes(initialResumes);
  }, [initialResumes]);

  const handleFileUpload = (file: File | undefined) => {
    if (!file || !dbAvailable || isPending) return;

    setStatus(null);

    if (file.size === 0) {
      setStatus({
        variant: "error",
        message: "The selected file is empty.",
      });
      return;
    }

    if (file.size > MAX_RESUME_BYTES) {
      setStatus({
        variant: "error",
        message: "Resume file must be 10 MB or smaller.",
      });
      return;
    }

    if (!isSupportedResumeFile(file)) {
      setStatus({
        variant: "error",
        message:
          "Unsupported file format. Please upload a PDF, DOC, or DOCX resume.",
      });
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    startTransition(async () => {
      const result = await uploadResumeAction(formData);
      if (!result.ok) {
        setStatus({ variant: "error", message: result.error });
        return;
      }

      setResumes((prev) => [result.data, ...prev]);
      setStatus({
        variant: "success",
        message: `"${result.data.fileName}" uploaded and saved.`,
      });
      router.refresh();
    });
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    handleFileUpload(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!dbAvailable || isPending) return;
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    handleFileUpload(file);
  };

  const handleDelete = (resume: Resume) => {
    if (isPending) return;

    setStatus(null);
    setDeletingId(resume.id);

    startTransition(async () => {
      const result = await deleteResumeAction(resume.id);
      setDeletingId(null);

      if (!result.ok) {
        setStatus({ variant: "error", message: result.error });
        return;
      }

      setResumes((prev) => prev.filter((item) => item.id !== resume.id));
      setStatus({
        variant: "success",
        message: `"${resume.fileName}" removed.`,
      });
      router.refresh();
    });
  };

  const isUploading = isPending && deletingId === null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className="font-mono uppercase">
            Storage
          </Badge>
          <Badge
            variant={resumes.length > 0 ? "teal" : "outline"}
            className="font-mono text-[11px]"
          >
            {resumes.length} {resumes.length === 1 ? "file" : "files"}
          </Badge>
        </div>
        <CardTitle className="text-xl">Resume / CV</CardTitle>
        <CardDescription>
          Upload your PDF or Word resume to Supabase Storage so it is saved for
          viewing, downloading, and automated applications.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <input
          ref={fileInputRef}
          type="file"
          aria-label="Upload resume file"
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          disabled={!dbAvailable || isPending}
          onChange={handleFileInputChange}
        />

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-5 text-center transition-colors duration-200",
            isDragging
              ? "border-aura-primary bg-primary/10"
              : "border-border bg-background/45 hover:border-aura-primary/40",
            (!dbAvailable || isPending) && "opacity-65",
          )}
        >
          <span className="border-aura-primary/25 bg-primary/10 text-aura-primary inline-flex size-10 items-center justify-center rounded-xl border">
            {isUploading ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Upload aria-hidden="true" className="size-4" />
            )}
          </span>

          <div className="space-y-1">
            <p className="font-heading text-foreground text-sm font-medium">
              {isUploading
                ? "Uploading resume..."
                : "Drop your resume here or browse"}
            </p>
            <p className="text-muted-foreground font-mono text-[11px]">
              PDF, DOC, or DOCX · Max 10 MB
            </p>
          </div>

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!dbAvailable || isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            {isUploading ? "Uploading..." : "Choose file"}
          </Button>
        </div>

        {status && (
          <FormAlert variant={status.variant} message={status.message} />
        )}

        {resumes.length === 0 ? (
          <p className="text-muted-foreground text-xs leading-relaxed">
            No resume uploaded yet. Upload one above and it will stay saved to
            your account.
          </p>
        ) : (
          <ul className="space-y-2.5" aria-label="Uploaded resumes">
            {resumes.map((resume) => {
              const isDeleting = deletingId === resume.id;
              return (
                <li
                  key={resume.id}
                  className="border-border/80 bg-background/50 hover:border-aura-primary/35 flex flex-col gap-3 rounded-xl border p-3.5 transition-colors duration-200"
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span className="border-aura-secondary/30 bg-aura-secondary/12 text-aura-secondary mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg border">
                        <FileText aria-hidden="true" className="size-4" />
                      </span>
                      <div className="min-w-0 space-y-1">
                        <p
                          title={resume.fileName}
                          className="text-foreground truncate text-sm font-medium"
                        >
                          {resume.fileName}
                        </p>
                        <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                          <Badge
                            variant="outline"
                            className="px-1.5 py-0 text-[10px]"
                          >
                            {getFileTypeLabel(resume)}
                          </Badge>
                          <span>{formatFileSize(resume.fileSize)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{formatUploadDate(resume.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <a
                      href={`/api/resumes/${resume.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonVariants({
                        variant: "outline",
                        size: "xs",
                      })}
                    >
                      <ExternalLink aria-hidden="true" className="size-3" />
                      View
                    </a>
                    <a
                      href={`/api/resumes/${resume.id}?download=1`}
                      className={buttonVariants({
                        variant: "ghost",
                        size: "xs",
                      })}
                    >
                      <Download aria-hidden="true" className="size-3" />
                      Download
                    </a>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="text-destructive hover:bg-destructive/12 hover:text-destructive"
                      aria-label={`Delete ${resume.fileName}`}
                      disabled={isPending}
                      onClick={() => handleDelete(resume)}
                    >
                      {isDeleting ? (
                        <Loader2
                          aria-hidden="true"
                          className="size-3 animate-spin"
                        />
                      ) : (
                        <Trash2 aria-hidden="true" className="size-3" />
                      )}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
