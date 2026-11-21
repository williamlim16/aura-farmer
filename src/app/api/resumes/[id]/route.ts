import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createClient } from "~/lib/supabase/server";
import { db } from "~/server/db";
import { resumes } from "~/server/db/schema";
import { downloadResumeObject } from "~/server/storage/resume-storage";

const uuidSchema = z.string().uuid();

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let userId = typeof data.claims.sub === "string" ? data.claims.sub : null;
  if (!userId) {
    const { data: userData } = await supabase.auth.getUser();
    userId = userData.user?.id ?? null;
  }

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 });
  }

  try {
    const [resume] = await db
      .select()
      .from(resumes)
      .where(and(eq(resumes.id, parsedId.data), eq(resumes.userId, userId)))
      .limit(1);

    if (!resume) {
      return NextResponse.json({ error: "Resume not found" }, { status: 404 });
    }

    const arrayBuffer = await downloadResumeObject({
      bucketId: resume.bucketId,
      storagePath: resume.storagePath,
    });

    const isDownload = request.nextUrl.searchParams.get("download") === "1";
    const dispositionType = isDownload ? "attachment" : "inline";
    const asciiFallback = resume.fileName.replace(/[^\x20-\x7E]|["\\]/g, "_");
    const encodedFilename = encodeURIComponent(resume.fileName);

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": resume.mimeType,
        "Content-Disposition": `${dispositionType}; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`,
        "Content-Length": String(arrayBuffer.byteLength),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("Failed to fetch resume file:", err);
    return NextResponse.json(
      { error: "Unable to retrieve resume file." },
      { status: 500 },
    );
  }
}
