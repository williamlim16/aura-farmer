import { NextResponse } from "next/server";

import { createClient } from "~/lib/supabase/server";
import { handleResumeUpload } from "~/server/resume/upload";
import { getStorage, StorageError } from "~/server/storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // Auth: the Supabase session cookie identifies the user; the storage key is
  // scoped to their id. (Middleware already redirects anonymous page requests.)
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;

  let file: FormDataEntryValue | null = null;
  try {
    file = (await request.formData()).get("resume");
  } catch {
    return NextResponse.json(
      { success: false, error: "Expected multipart form data.", code: "bad_request" },
      { status: 400 },
    );
  }

  let storage;
  try {
    storage = getStorage();
  } catch (err) {
    console.error("[resume-upload] storage config:", err instanceof StorageError ? err.message : err);
    return NextResponse.json(
      { success: false, error: "Upload is not configured.", code: "storage_config" },
      { status: 500 },
    );
  }

  const result = await handleResumeUpload({ userId, file, storage });
  return NextResponse.json(result.body, { status: result.status });
}
