import { applicationActionHandler, getApplicationHandler } from "~/server/api/handlers";
import { apiDeps, currentUserId, errorResponse, guarded, readJson, respond, sameOrigin } from "~/server/api/next";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = guarded(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  return respond(await getApplicationHandler(await currentUserId(), id, await apiDeps()));
});

/** Body: { action: "rerun" | "cancel" | "mark_submitted" } */
export const POST = guarded(async (request: Request, ctx: Ctx) => {
  if (!sameOrigin(request)) return errorResponse(403, "Cross-origin request refused.", "bad_origin");
  const userId = await currentUserId();
  if (!userId) return errorResponse(401, "Please sign in.", "unauthenticated");
  const body = await readJson(request);
  if (!body.ok) return errorResponse(body.status, body.error, "bad_request");
  const { id } = await ctx.params;
  return respond(await applicationActionHandler(userId, id, body.body, await apiDeps()));
});
