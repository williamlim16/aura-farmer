import { screenshotKey } from "~/server/jobs/worker";
import { apiDeps, currentUserId, errorResponse, guarded } from "~/server/api/next";

export const runtime = "nodejs";

/** The latest autofill screenshot for the caller's own application. */
export const GET = guarded(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const userId = await currentUserId();
  if (!userId) return errorResponse(401, "Please sign in.", "unauthenticated");
  const { id } = await ctx.params;
  const deps = await apiDeps();
  const app = await deps.repos.applications.get(userId, id);
  if (!app) return errorResponse(404, "Not found.", "not_found");
  const png = await deps.storage.get(screenshotKey(userId, app.id));
  if (!png) return errorResponse(404, "No screenshot yet.", "not_found");
  return new Response(Buffer.from(png), {
    headers: { "content-type": "image/png", "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
});
