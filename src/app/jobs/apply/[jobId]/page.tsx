import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ApplyWithAi, type ContactKey } from "~/components/apply-real/apply-with-ai";
import { applyWithAiEnabled } from "~/lib/apply/flag";
import { requireUser } from "~/server/auth";
import { getApplyJob, getApplyProfile, getResumeSummary } from "~/server/apply-real/team-data";

export const metadata: Metadata = { title: "Apply with AI" };
export const maxDuration = 60;

export default async function ApplyWithAiJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  if (!applyWithAiEnabled()) notFound();
  const user = await requireUser();
  const jobId = Number((await params).jobId);
  const job = await getApplyJob(user.id, jobId);
  if (!job) notFound();
  const [profile, resume] = await Promise.all([getApplyProfile(user.id, user.email), getResumeSummary(user.id, job.id)]);
  const initialContact = Object.fromEntries(
    (["fullName", "firstName", "lastName", "email", "phone", "location", "linkedin", "github", "website"] as ContactKey[]).map((k) => [k, profile.contact[k]?.value ?? ""]),
  ) as Record<ContactKey, string>;

  return (
    <ApplyWithAi
      jobId={job.id}
      jobTitle={job.title}
      company={job.company}
      initialUrl={job.url}
      directlySupported={job.directlySupported}
      initialContact={initialContact}
      profileSummary={{ roles: profile.experience.length, education: profile.education.length, skills: profile.skills.length }}
      resume={resume}
    />
  );
}
