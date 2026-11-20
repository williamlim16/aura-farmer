import { decideTailoringHandler, tailorPostingHandler } from "~/server/api/postings";
import { apiDeps, currentUserId, errorResponse, guarded, readJson, respond, sameOrigin } from "~/server/api/next";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/** Generate (or regenerate) tailoring suggestions and draft answers. */
export const POST = guarded(async (request: Request, ctx: Ctx) => {
  if (!sameOrigin(request)) return errorResponse(403, "Cross-origin request refused.", "bad_origin");
  const userId = await currentUserId();
  if (!userId) return errorResponse(401, "Please sign in.", "unauthenticated");
  return respond(await tailorPostingHandler(userId, (await ctx.params).id, await apiDeps()));
});

/** Accept / reject suggestions and edit draft answers. */
export const PUT = guarded(async (request: Request, ctx: Ctx) => {
  if (!sameOrigin(request)) return errorResponse(403, "Cross-origin request refused.", "bad_origin");
  const userId = await currentUserId();
  if (!userId) return errorResponse(401, "Please sign in.", "unauthenticated");
  const body = await readJson(request);
  if (!body.ok) return errorResponse(body.status, body.error, "bad_request");
  return respond(await decideTailoringHandler(userId, (await ctx.params).id, body.body, await apiDeps()));
});
