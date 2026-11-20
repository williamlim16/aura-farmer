import { notFound } from "next/navigation";

import { ApplicationReview, type ApplicationDTO } from "~/components/apply/application-review";
import { getApplicationHandler } from "~/server/api/handlers";
import { requireUser } from "~/server/api/session";

export const dynamic = "force-dynamic";

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId, deps } = await requireUser();
  const res = await getApplicationHandler(userId, id, deps);
  if (res.status !== 200) notFound();
  return <ApplicationReview initial={(res.body as { application: ApplicationDTO }).application} />;
}
