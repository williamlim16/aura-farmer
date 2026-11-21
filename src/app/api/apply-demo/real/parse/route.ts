import { parseResumeText } from "~/lib/resume/parse-profile";
import { json, readRequest } from "~/server/apply-real/request";
import { extractResumeText } from "~/server/resume/extract-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Parse the uploaded resume into a profile for the user to review. Nothing is stored. */
export async function POST(request: Request) {
  const r = await readRequest(request);
  if (r instanceof Response) return r;
  const resume = await r.resume();
  if (typeof resume === "string") return json(400, { error: resume });
  try {
    const parsed = parseResumeText(await extractResumeText(resume.bytes, resume.kind));
    return json(200, { profile: parsed.profile, missing: parsed.missing });
  } catch (e) {
    return json(422, { error: `Could not read text from the resume (${e instanceof Error ? e.message : "unknown"}).` });
  }
}
