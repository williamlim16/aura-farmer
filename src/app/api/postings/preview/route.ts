import { previewPostingHandler } from "~/server/api/postings";
import { apiDeps, currentUserId, errorResponse, guarded, readJson, respond, sameOrigin } from "~/server/api/next";

export const runtime = "nodejs";

/** Read a posting from a supported public job-board API (not saved). */
export const POST = guarded(async (request: Request) => {
  if (!sameOrigin(request)) return errorResponse(403, "Cross-origin request refused.", "bad_origin");
  const userId = await currentUserId();
  if (!userId) return errorResponse(401, "Please sign in.", "unauthenticated");
  const body = await readJson(request);
  if (!body.ok) return errorResponse(body.status, body.error, "bad_request");
  void apiDeps;
  return respond(await previewPostingHandler(userId, body.body));
});
