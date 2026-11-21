/**
 * Resume file validation shared by the browser (fast feedback) and the server
 * (the authoritative check). Pure: no Node or DOM APIs beyond Uint8Array.
 */

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

export const RESUME_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export type ResumeKind = keyof typeof RESUME_TYPES;

export type ResumeValidationError =
  | "missing"
  | "empty"
  | "too_large"
  | "bad_extension"
  | "bad_content";

export const RESUME_ERROR_MESSAGES: Record<ResumeValidationError, string> = {
  missing: "Please select a resume.",
  empty: "The selected file is empty.",
  too_large: "File must be smaller than 5 MB.",
  bad_extension: "Please choose a PDF or DOCX file.",
  bad_content: "The file content does not match a PDF or DOCX document.",
};

export type ResumeMetaResult =
  | { ok: true; kind: ResumeKind }
  | { ok: false; error: ResumeValidationError };

/** Name/size checks only. Safe to run in the browser before uploading. */
export function validateResumeMeta(
  file: { name: string; size: number } | null | undefined,
): ResumeMetaResult {
  if (!file) return { ok: false, error: "missing" };
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext !== "pdf" && ext !== "docx") return { ok: false, error: "bad_extension" };
  if (file.size === 0) return { ok: false, error: "empty" };
  if (file.size > MAX_RESUME_BYTES) return { ok: false, error: "too_large" };
  return { ok: true, kind: ext };
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // local file header

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

function containsAscii(bytes: Uint8Array, needle: string): boolean {
  // DOCX is a ZIP; entry names are stored uncompressed in the headers.
  const n = Array.from(needle, (c) => c.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) if (bytes[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * Content check against the declared kind. A DOCX must be a ZIP that contains
 * a `word/` part, so renamed .zip/.xlsx files are rejected.
 */
export function sniffResumeContent(bytes: Uint8Array, kind: ResumeKind): boolean {
  if (kind === "pdf") return startsWith(bytes, PDF_MAGIC);
  return startsWith(bytes, ZIP_MAGIC) && containsAscii(bytes, "word/");
}

export type ResumeFullResult =
  | { ok: true; kind: ResumeKind; contentType: string }
  | { ok: false; error: ResumeValidationError };

/** Full server-side validation: metadata plus content sniffing. */
export function validateResumeBytes(name: string, bytes: Uint8Array): ResumeFullResult {
  const meta = validateResumeMeta({ name, size: bytes.byteLength });
  if (!meta.ok) return meta;
  if (!sniffResumeContent(bytes, meta.kind)) return { ok: false, error: "bad_content" };
  return { ok: true, kind: meta.kind, contentType: RESUME_TYPES[meta.kind] };
}
