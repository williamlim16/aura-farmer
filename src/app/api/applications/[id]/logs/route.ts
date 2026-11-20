import { applicationLogsHandler } from "~/server/api/handlers";
import { apiDeps, currentUserId, guarded, respond } from "~/server/api/next";

export const runtime = "nodejs";

export const GET = guarded(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  return respond(await applicationLogsHandler(await currentUserId(), id, await apiDeps()));
});
