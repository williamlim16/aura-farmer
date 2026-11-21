import { apiDeps, currentUserId, errorResponse, guarded } from "~/server/api/next";

export const runtime = "nodejs";

/** Download one of the caller's own resume versions (original or tailored) through the app storage driver (memory/file in dev, S3 in production). The team's /api/resumes/[id] reads Supabase directly. */
export const GET = guarded(async (_r: Request, ctx: { params: Promise<{ id: string }> }) => {
  const userId = await currentUserId();
  if (!userId) return errorResponse(401, "Please sign in.", "unauthenticated");
  const deps = await apiDeps();
  const rec = await deps.repos.resumes.get(userId, (await ctx.params).id);
  if (!rec) return errorResponse(404, "Not found.", "not_found");
  const bytes = await deps.storage.get(rec.storageKey);
  if (!bytes) return errorResponse(404, "File missing.", "not_found");
  const type = rec.kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return new Response(Buffer.from(bytes), { headers: { "content-type": type, "content-disposition": `attachment; filename="${rec.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
});
