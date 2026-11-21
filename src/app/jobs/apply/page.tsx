import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ApplyWithAi, type ContactKey } from "~/components/apply-real/apply-with-ai";
import { applyWithAiEnabled } from "~/lib/apply/flag";
import { requireUser } from "~/server/auth";
import { getApplyProfile, getResumeSummary } from "~/server/apply-real/team-data";

export const metadata: Metadata = { title: "Apply with AI: paste a job URL" };
export const dynamic = "force-dynamic";

/** Fallback for jobs whose listing is not a Greenhouse/Lever page: paste the employer's application link. */
export default async function ApplyWithAiPastePage() {
  if (!applyWithAiEnabled()) notFound();
  const user = await requireUser();
  const [profile, resume] = await Promise.all([getApplyProfile(user.id, user.email), getResumeSummary(user.id, null)]);
  const initialContact = Object.fromEntries(
    (["fullName", "firstName", "lastName", "email", "phone", "location", "linkedin", "github", "website"] as ContactKey[]).map((k) => [k, profile.contact[k]?.value ?? ""]),
  ) as Record<ContactKey, string>;

  return (
    <ApplyWithAi
      jobId={null}
      jobTitle={null}
      company={null}
      initialUrl=""
      directlySupported
      initialContact={initialContact}
      profileSummary={{ roles: profile.experience.length, education: profile.education.length, skills: profile.skills.length }}
      resume={resume}
    />
  );
}
