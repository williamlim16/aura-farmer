import { notFound } from "next/navigation";

import { JobWorkspace, type PostingDTO } from "~/components/apply/job-workspace";
import { publicPosting } from "~/server/api/postings";
import { llmAvailability, requireUser } from "~/server/api/session";

export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId, deps } = await requireUser();
  const [posting, profile, apps] = await Promise.all([deps.repos.postings.get(userId, id), deps.repos.profiles.get(userId), deps.repos.applications.list(userId, { limit: 200 })]);
  if (!posting) notFound();
  const linked = apps.filter((a) => a.postingId === posting.id).map((a) => ({ id: a.id, status: a.status, createdAt: a.createdAt.toISOString() }));
  return <JobWorkspace initial={publicPosting(posting) as unknown as PostingDTO} hasProfile={!!profile} llm={llmAvailability()} applications={linked} />;
}
