import { fillPlanHandler } from "~/server/api/handlers";
import { apiDeps, currentUserId, guarded, respond } from "~/server/api/next";

export const runtime = "nodejs";

export const GET = guarded(async (_r: Request, ctx: { params: Promise<{ id: string }> }) => respond(await fillPlanHandler(await currentUserId(), (await ctx.params).id, await apiDeps())));
