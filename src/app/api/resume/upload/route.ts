import { ingestHandler } from "~/server/api/handlers";
import { apiDeps, currentUserId, errorResponse, guarded, respond, sameOrigin } from "~/server/api/next";

export const runtime = "nodejs";

/** Upload a resume, extract text, parse and save the candidate profile. */
export const POST = guarded(async (request: Request) => {
  if (!sameOrigin(request)) return errorResponse(403, "Cross-origin request refused.", "bad_origin");
  const userId = await currentUserId();
  if (!userId) return errorResponse(401, "Please sign in.", "unauthenticated");
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > 6 * 1024 * 1024) return errorResponse(413, "File must be smaller than 5 MB.", "too_large");
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("resume");
  } catch {
    return errorResponse(400, "Expected multipart form data.", "bad_request");
  }
  return respond(await ingestHandler(userId, file, await apiDeps()));
});
