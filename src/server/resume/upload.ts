import {
  RESUME_ERROR_MESSAGES,
  validateResumeBytes,
  type ResumeKind,
} from "~/lib/resume/validate";
import { StorageError, type ObjectStorage } from "~/server/storage/types";

export type UploadResult =
  | { status: 201; body: { success: true; path: string; kind: ResumeKind; filename: string } }
  | { status: 400 | 401 | 500 | 503; body: { success: false; error: string; code: string } };

/** Object keys are scoped per user so storage policies can match on the first path segment. */
export function resumeKey(userId: string, kind: ResumeKind, id: string = crypto.randomUUID()) {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(userId)) throw new Error("invalid user id");
  return `${userId}/resumes/${id}.${kind}`;
}

/**
 * Framework-independent upload logic, so it can be tested without Next.js or
 * Supabase. The route only does auth, reads the form, and calls this.
 */
export async function handleResumeUpload(input: {
  userId: string | null;
  file: unknown;
  storage: ObjectStorage;
}): Promise<UploadResult> {
  if (!input.userId) {
    return { status: 401, body: { success: false, error: "Please sign in.", code: "unauthenticated" } };
  }
  const file = input.file;
  if (!(file instanceof Blob) || !("name" in file)) {
    return { status: 400, body: { success: false, error: RESUME_ERROR_MESSAGES.missing, code: "missing" } };
  }
  const name = String((file as File).name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateResumeBytes(name, bytes);
  if (!check.ok) {
    return { status: 400, body: { success: false, error: RESUME_ERROR_MESSAGES[check.error], code: check.error } };
  }

  const path = resumeKey(input.userId, check.kind);
  try {
    await input.storage.put(path, bytes, check.contentType);
  } catch (err) {
    const code = err instanceof StorageError ? err.code : "unknown";
    // Log the classified message only; never the credentials or raw request.
    console.error(`[resume-upload] storage ${code}:`, err instanceof Error ? err.message : err);
    const status = code === "unavailable" ? 503 : 500;
    return { status, body: { success: false, error: "Upload failed. Please try again later.", code: `storage_${code}` } };
  }
  return { status: 201, body: { success: true, path, kind: check.kind, filename: name } };
}
