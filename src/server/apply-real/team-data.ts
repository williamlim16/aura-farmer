/**
 * Loads what an "Apply with AI" run needs, strictly for the signed-in user and
 * through the team's own tables and storage helper: the job (integer job.id),
 * the user's profile, and the resume file (the job's tailored resume when one
 * exists, otherwise the latest uploaded resume). Read-only.
 */
import { and, desc, eq } from "drizzle-orm";

import { validateResumeBytes, type ResumeKind } from "~/lib/resume/validate";
import { db } from "~/server/db";
import { educations, experiences, jobs, resumes, tailoredResumes, userProfiles } from "~/server/db/schema";
import { downloadResumeObject } from "~/server/storage/resume-storage";
import { applyUrlFor } from "./resolve";
import { teamProfileToCandidate } from "./team-profile";

export interface ApplyJob {
  id: number;
  title: string;
  company: string | null;
  url: string;
  /** True when the stored job URL is directly a Greenhouse/Lever posting. */
  directlySupported: boolean;
}

export type ResumeSource = "tailored" | "uploaded";
export interface ResumeFile {
  bytes: Uint8Array;
  kind: ResumeKind;
  filename: string;
  source: ResumeSource;
}

export async function getApplyJob(userId: string, jobId: number): Promise<ApplyJob | null> {
  if (!Number.isSafeInteger(jobId) || jobId <= 0 || jobId > 2_147_483_647) return null;
  const [j] = await db
    .select({ id: jobs.id, title: jobs.title, company: jobs.company, url: jobs.url })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
  return j ? { ...j, directlySupported: applyUrlFor(j.url) !== null } : null;
}

export async function getApplyProfile(userId: string, email: string | null) {
  const [[profile], experienceRows, educationRows] = await Promise.all([
    db.select().from(userProfiles).where(eq(userProfiles.userId, userId)),
    db.select().from(experiences).where(eq(experiences.userId, userId)).orderBy(desc(experiences.createdAt)),
    db.select().from(educations).where(eq(educations.userId, userId)).orderBy(desc(educations.createdAt)),
  ]);
  return teamProfileToCandidate({ profile: profile ?? null, experiences: experienceRows, educations: educationRows, email });
}

const safeName = (s: string) => s.replace(/[^\w.\- ]/g, "_").slice(0, 80) || "resume";

/** Tailored resume for this job (PDF) first; otherwise the user's most recent upload (PDF or DOCX). */
export async function getApplyResume(userId: string, jobId: number | null): Promise<ResumeFile | { error: string }> {
  try {
    if (jobId !== null) {
      const [t] = await db
        .select({ pdfPath: tailoredResumes.pdfPath })
        .from(tailoredResumes)
        .where(and(eq(tailoredResumes.userId, userId), eq(tailoredResumes.jobId, jobId)));
      if (t?.pdfPath) {
        const bytes = new Uint8Array(await downloadResumeObject({ storagePath: t.pdfPath }));
        const check = validateResumeBytes("resume.pdf", bytes);
        if (check.ok) return { bytes, kind: check.kind, filename: "tailored-resume.pdf", source: "tailored" };
      }
    }
    const [r] = await db
      .select({ storagePath: resumes.storagePath, bucketId: resumes.bucketId, fileName: resumes.fileName })
      .from(resumes)
      .where(eq(resumes.userId, userId))
      .orderBy(desc(resumes.createdAt))
      .limit(1);
    if (!r) return { error: "Upload your resume on the Profile page first." };
    const bytes = new Uint8Array(await downloadResumeObject({ bucketId: r.bucketId, storagePath: r.storagePath }));
    const check = validateResumeBytes(r.fileName, bytes);
    if (!check.ok) return { error: "Your uploaded resume must be a PDF or DOCX to attach it to an application." };
    return { bytes, kind: check.kind, filename: safeName(r.fileName), source: "uploaded" };
  } catch (e) {
    console.error("[apply-with-ai] resume load failed:", e instanceof Error ? e.message : e);
    return { error: "Could not load your resume from storage." };
  }
}

/** What the review page shows about the resume that will be attached (no file download). */
export async function getResumeSummary(userId: string, jobId: number | null): Promise<{ source: ResumeSource; fileName: string } | null> {
  if (jobId !== null) {
    const [t] = await db
      .select({ pdfPath: tailoredResumes.pdfPath })
      .from(tailoredResumes)
      .where(and(eq(tailoredResumes.userId, userId), eq(tailoredResumes.jobId, jobId)));
    if (t?.pdfPath) return { source: "tailored", fileName: "Tailored resume for this job (PDF)" };
  }
  const [r] = await db.select({ fileName: resumes.fileName }).from(resumes).where(eq(resumes.userId, userId)).orderBy(desc(resumes.createdAt)).limit(1);
  return r ? { source: "uploaded", fileName: r.fileName } : null;
}
