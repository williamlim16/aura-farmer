/**
 * Upload -> store -> read back -> extract text -> parse profile.
 * Reuses handleResumeUpload (validation + storage) unchanged, then reads the
 * object back through the same storage interface so the hosted version
 * (S3/Supabase) exercises the identical path.
 */
import type { CandidateProfile } from "~/lib/profile/schema";
import { parseResumeText } from "~/lib/resume/parse-profile";
import type { ResumeKind } from "~/lib/resume/validate";
import { extractResumeText, ResumeTextError } from "~/server/resume/extract-text";
import { handleResumeUpload } from "~/server/resume/upload";
import type { ObjectStorage } from "~/server/storage/types";

export type IngestResult =
  | {
      ok: true;
      status: 201;
      resume: { path: string; kind: ResumeKind; filename: string };
      profile: CandidateProfile;
      missing: string[];
      textChars: number;
    }
  | { ok: false; status: number; error: string; code: string };

export async function ingestResume(input: { userId: string | null; file: unknown; storage: ObjectStorage }): Promise<IngestResult> {
  const up = await handleResumeUpload(input);
  if (!up.body.success) return { ok: false, status: up.status, error: up.body.error, code: up.body.code };
  const { path, kind, filename } = up.body;

  const bytes = await input.storage.get(path);
  if (!bytes) return { ok: false, status: 500, error: "Stored resume could not be read back.", code: "storage_readback" };

  let text: string;
  try {
    text = await extractResumeText(bytes, kind);
  } catch (err) {
    // The upload succeeded but is unusable; remove it so it is not orphaned.
    await input.storage.delete(path).catch(() => undefined);
    if (err instanceof ResumeTextError) return { ok: false, status: 422, error: err.message, code: `text_${err.code}` };
    return { ok: false, status: 500, error: "Could not read this resume.", code: "text_unknown" };
  }

  const { profile, missing } = parseResumeText(text);
  return { ok: true, status: 201, resume: { path, kind, filename }, profile, missing, textChars: text.length };
}
