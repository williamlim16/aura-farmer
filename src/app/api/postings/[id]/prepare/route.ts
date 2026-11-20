import { preparePostingApplicationHandler } from "~/server/api/postings";
import { apiDeps, currentUserId, errorResponse, guarded, readJson, respond, sameOrigin } from "~/server/api/next";

export const runtime = "nodejs";

export const POST = guarded(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  if (!sameOrigin(request)) return errorResponse(403, "Cross-origin request refused.", "bad_origin");
  const userId = await currentUserId();
  if (!userId) return errorResponse(401, "Please sign in.", "unauthenticated");
  const body = await readJson(request);
  if (!body.ok) return errorResponse(body.status, body.error, "bad_request");
  return respond(await preparePostingApplicationHandler(userId, (await ctx.params).id, body.body, await apiDeps()));
});
