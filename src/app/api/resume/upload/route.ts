import { ingestHandler } from "~/server/api/handlers";
import { apiDeps, currentUserId, errorResponse, guarded, respond, sameOrigin } from "~/server/api/next";

export const runtime = "nodejs";

/** Upload a resume, extract text, parse and save the candidate profile. */
export const POST = guarded(async (request: Request) => {
  if (!sameOrigin(request)) return errorResponse(403, "Cross-origin request refused.", "bad_origin");
  const userId = await currentUserId();
  if (!userId) return errorResponse(401, "Please sign in.", "unauthenticated");
  // Require a declared length so a chunked body cannot be buffered without limit;
  // Node's HTTP parser enforces the declared length as the message framing.
  const declared = request.headers.get("content-length");
  if (!declared) return errorResponse(411, "Content-Length is required.", "length_required");
  const len = Number(declared);
  if (!Number.isFinite(len) || len > 6 * 1024 * 1024) return errorResponse(413, "File must be smaller than 5 MB.", "too_large");
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("resume");
  } catch {
    return errorResponse(400, "Expected multipart form data.", "bad_request");
  }
  return respond(await ingestHandler(userId, file, await apiDeps()));
});
