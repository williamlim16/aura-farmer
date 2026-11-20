import { deletePostingHandler, getPostingHandler, updatePostingHandler } from "~/server/api/postings";
import { apiDeps, currentUserId, errorResponse, guarded, readJson, respond, sameOrigin } from "~/server/api/next";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

export const GET = guarded(async (_r: Request, ctx: Ctx) => respond(await getPostingHandler(await currentUserId(), (await ctx.params).id, await apiDeps())));

export const PUT = guarded(async (request: Request, ctx: Ctx) => {
  if (!sameOrigin(request)) return errorResponse(403, "Cross-origin request refused.", "bad_origin");
  const userId = await currentUserId();
  if (!userId) return errorResponse(401, "Please sign in.", "unauthenticated");
  const body = await readJson(request);
  if (!body.ok) return errorResponse(body.status, body.error, "bad_request");
  return respond(await updatePostingHandler(userId, (await ctx.params).id, body.body, await apiDeps()));
});

export const DELETE = guarded(async (request: Request, ctx: Ctx) => {
  if (!sameOrigin(request)) return errorResponse(403, "Cross-origin request refused.", "bad_origin");
  return respond(await deletePostingHandler(await currentUserId(), (await ctx.params).id, await apiDeps()));
});
