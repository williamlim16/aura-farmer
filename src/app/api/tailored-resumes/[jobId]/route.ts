import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createClient } from "~/lib/supabase/server";
import { downloadResumeObject } from "~/server/storage/resume-storage";
import { getTailoredResume } from "~/server/tailored-resumes";

const jobIdSchema = z.coerce.number().int().positive();

function fileName(title: string, company: string | null, ext: string) {
  const base = ["Resume", company, title]
    .filter(Boolean)
    .join(" - ")
    .replace(/[^\w\- ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return `${base || "Resume"}.${ext}`;
}

/**
 * GET /api/tailored-resumes/:jobId?format=pdf|tex[&download=1]
 * Serves the signed-in user's tailored resume for a job.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId =
    !error && typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedId = jobIdSchema.safeParse((await context.params).jobId);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const format =
    request.nextUrl.searchParams.get("format") === "tex" ? "tex" : "pdf";
  const disposition =
    request.nextUrl.searchParams.get("download") === "1" || format === "tex"
      ? "attachment"
      : "inline";

  try {
    const resume = await getTailoredResume(userId, parsedId.data);
    if (!resume || (format === "pdf" && !resume.pdfPath)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const name = fileName(resume.jobTitle, resume.company, format);
    const body =
      format === "tex"
        ? new TextEncoder().encode(resume.tex)
        : new Uint8Array(
            await downloadResumeObject({ storagePath: resume.pdfPath! }),
          );

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type":
          format === "tex"
            ? "application/x-tex; charset=utf-8"
            : "application/pdf",
        "Content-Disposition": `${disposition}; filename="${name}"`,
        "Content-Length": String(body.byteLength),
        // Re-tailoring overwrites the file in place; links carry ?v=updatedAt.
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("Failed to fetch tailored resume:", err);
    return NextResponse.json(
      { error: "Unable to retrieve the resume." },
      { status: 500 },
    );
  }
}
