import { matchPostingHandler } from "~/server/api/postings";
import { apiDeps, currentUserId, errorResponse, guarded, readJson, respond, sameOrigin } from "~/server/api/next";

export const runtime = "nodejs";

export const POST = guarded(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  if (!sameOrigin(request)) return errorResponse(403, "Cross-origin request refused.", "bad_origin");
  const userId = await currentUserId();
  if (!userId) return errorResponse(401, "Please sign in.", "unauthenticated");
  void readJson;
  return respond(await matchPostingHandler(userId, (await ctx.params).id, await apiDeps()));
});
