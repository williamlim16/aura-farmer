import { ProfileEditor } from "~/components/apply/profile-editor";
import { getProfileHandler } from "~/server/api/handlers";
import { requireUser } from "~/server/api/session";
import type { ProfileReview } from "~/lib/profile/review";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const { userId, deps } = await requireUser();
  const res = await getProfileHandler(userId, deps);
  const body = res.body as { review?: ProfileReview; version?: number; resume?: { filename: string; createdAt: string } | null };
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Your profile</h1>
        <p className="text-muted-foreground text-sm">Extracted from your resume. Check and correct it before preparing applications.</p>
      </div>
      <ProfileEditor initial={body.review ? { review: body.review, version: body.version!, resume: body.resume ?? null } : null} />
    </div>
  );
}
