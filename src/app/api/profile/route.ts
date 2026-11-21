import { getProfileHandler, putProfileHandler } from "~/server/api/handlers";
import { apiDeps, currentUserId, errorResponse, guarded, readJson, respond, sameOrigin } from "~/server/api/next";

export const runtime = "nodejs";

export const GET = guarded(async () => respond(await getProfileHandler(await currentUserId(), await apiDeps())));

export const PUT = guarded(async (request: Request) => {
  if (!sameOrigin(request)) return errorResponse(403, "Cross-origin request refused.", "bad_origin");
  const userId = await currentUserId();
  if (!userId) return errorResponse(401, "Please sign in.", "unauthenticated");
  const body = await readJson(request);
  if (!body.ok) return errorResponse(body.status, body.error, "bad_request");
  return respond(await putProfileHandler(userId, body.body, await apiDeps()));
});
