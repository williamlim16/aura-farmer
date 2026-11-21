/**
 * Resume tailoring for tracked jobs:
 * profile + job description → Claude (structured JSON) → resume.tex → Octree → PDF.
 */

import { and, desc, eq } from "drizzle-orm";

import { db } from "~/server/db";
import {
  educations,
  experiences,
  jobs,
  tailoredResumes,
  trackedJobs,
  userProfiles,
} from "~/server/db/schema";
import {
  RESUME_BUCKET,
  uploadResumeObject,
} from "~/server/storage/resume-storage";
import {
  generateTailoredContent,
  sanitizeTailoredContent,
  TAILOR_MODEL,
  TailorError,
} from "~/server/tailor/generate-content";
import { compileLatex } from "~/server/tailor/octree";
import { renderResume } from "~/server/tailor/render-resume";

export { TailorError };

/** Shown in the Tracking table's Resume column. */
export interface TailoredResumeStatus {
  hasPdf: boolean;
  compileError: string | null;
  updatedAt: number;
}

export type TailorOutcome =
  { ok: true; pdf: boolean; message: string } | { ok: false; message: string };

export function tailoredPdfPath(userId: string, jobId: number) {
  return `tailored/${userId}/${jobId}.pdf`;
}

export async function getTailoredResumeStatuses(
  userId: string,
): Promise<Map<number, TailoredResumeStatus>> {
  const rows = await db
    .select({
      jobId: tailoredResumes.jobId,
      pdfPath: tailoredResumes.pdfPath,
      compileError: tailoredResumes.compileError,
      updatedAt: tailoredResumes.updatedAt,
    })
    .from(tailoredResumes)
    .where(eq(tailoredResumes.userId, userId));
  return new Map(
    rows.map((r) => [
      r.jobId,
      {
        hasPdf: r.pdfPath !== null,
        compileError: r.compileError,
        updatedAt: r.updatedAt.getTime(),
      },
    ]),
  );
}

export async function getTailoredResume(userId: string, jobId: number) {
  const [row] = await db
    .select({
      tex: tailoredResumes.tex,
      pdfPath: tailoredResumes.pdfPath,
      jobTitle: jobs.title,
      company: jobs.company,
    })
    .from(tailoredResumes)
    .innerJoin(jobs, eq(jobs.id, tailoredResumes.jobId))
    .where(
      and(eq(tailoredResumes.userId, userId), eq(tailoredResumes.jobId, jobId)),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Compiles the stored .tex for a job and records the result. Spends one
 * Octree compile (30/day on the free plan), so it's only called once per
 * user action.
 */
async function compileAndStore(
  userId: string,
  jobId: number,
  tex: string,
): Promise<TailorOutcome> {
  const result = await compileLatex(tex);

  if (!result.ok) {
    await db
      .update(tailoredResumes)
      .set({ pdfPath: null, compileError: result.message })
      .where(
        and(
          eq(tailoredResumes.userId, userId),
          eq(tailoredResumes.jobId, jobId),
        ),
      );
    return { ok: false, message: result.message };
  }

  const pdfPath = tailoredPdfPath(userId, jobId);
  await uploadResumeObject({
    bucketId: RESUME_BUCKET,
    storagePath: pdfPath,
    body: result.pdf,
    contentType: "application/pdf",
  });
  await db
    .update(tailoredResumes)
    .set({ pdfPath, compileError: null })
    .where(
      and(eq(tailoredResumes.userId, userId), eq(tailoredResumes.jobId, jobId)),
    );

  const pages =
    result.pages && result.pages > 1 ? ` (${result.pages} pages)` : "";
  return { ok: true, pdf: true, message: `PDF ready${pages}.` };
}

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Generates (or regenerates) the tailored resume for one tracked job. */
export async function tailorResumeForJob(
  user: { id: string; email: string | null },
  jobId: number,
): Promise<TailorOutcome> {
  const [job] = await db
    .select({
      title: jobs.title,
      company: jobs.company,
      location: jobs.location,
      description: jobs.description,
      snippet: jobs.snippet,
    })
    .from(trackedJobs)
    .innerJoin(
      jobs,
      and(eq(jobs.id, trackedJobs.jobId), eq(jobs.userId, user.id)),
    )
    .where(and(eq(trackedJobs.userId, user.id), eq(trackedJobs.jobId, jobId)))
    .limit(1);
  if (!job)
    return { ok: false, message: "Job not found in your tracking list." };

  const jobDescription = job.description ?? job.snippet;
  if (!jobDescription?.trim()) {
    return {
      ok: false,
      message: "This job has no description yet. Fetch descriptions first.",
    };
  }

  const [[profile], exps, edus] = await Promise.all([
    db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, user.id))
      .limit(1),
    db
      .select()
      .from(experiences)
      .where(eq(experiences.userId, user.id))
      .orderBy(desc(experiences.isCurrent), desc(experiences.startDate)),
    db
      .select()
      .from(educations)
      .where(eq(educations.userId, user.id))
      .orderBy(desc(educations.isCurrent), desc(educations.startDate)),
  ]);

  if (!profile?.fullName?.trim()) {
    return { ok: false, message: "Add your name to your profile first." };
  }
  if (exps.length === 0 && edus.length === 0) {
    return {
      ok: false,
      message: "Add some experience or education to your profile first.",
    };
  }

  let content;
  try {
    const raw = await generateTailoredContent({
      job: {
        title: job.title,
        company: job.company,
        location: job.location,
        description: jobDescription,
      },
      profile: {
        headline: profile.headline,
        summary: profile.summary,
        skills: profile.skills,
      },
      experiences: exps.map((e) => ({
        id: e.id,
        jobTitle: e.jobTitle,
        company: e.company,
        employmentType: e.employmentType,
        location: e.location,
        startDate: e.startDate,
        endDate: e.endDate,
        isCurrent: e.isCurrent,
        description: e.description,
      })),
      educations: edus.map((e) => ({
        id: e.id,
        school: e.school,
        degree: e.degree,
        fieldOfStudy: e.fieldOfStudy,
        startDate: e.startDate,
        endDate: e.endDate,
        grade: e.grade,
        description: e.description,
      })),
    });
    content = sanitizeTailoredContent(
      raw,
      new Set(exps.map((e) => e.id)),
      new Set(edus.map((e) => e.id)),
    );
  } catch (err) {
    if (err instanceof TailorError) return { ok: false, message: err.message };
    throw err;
  }

  const tex = renderResume(
    content,
    {
      fullName: profile.fullName,
      email: user.email,
      phone: profile.phone,
      location: profile.location,
      headline: profile.headline,
      websiteUrl: profile.websiteUrl,
      linkedinUrl: profile.linkedinUrl,
      githubUrl: profile.githubUrl,
    },
    exps,
    edus,
  );

  await db
    .insert(tailoredResumes)
    .values({
      userId: user.id,
      jobId,
      content,
      tex,
      model: TAILOR_MODEL,
    })
    .onConflictDoUpdate({
      target: [tailoredResumes.userId, tailoredResumes.jobId],
      set: {
        content,
        tex,
        model: TAILOR_MODEL,
        pdfPath: null,
        compileError: null,
        updatedAt: new Date(),
      },
    });

  const compiled = await compileAndStore(user.id, jobId, tex);
  return compiled.ok
    ? { ok: true, pdf: true, message: `Resume tailored. ${compiled.message}` }
    : {
        ok: true,
        pdf: false,
        message: `Resume tailored, but ${lowerFirst(compiled.message)}`,
      };
}

/** Retries just the PDF compile for an already-tailored resume (no LLM call). */
export async function recompileTailoredResume(
  userId: string,
  jobId: number,
): Promise<TailorOutcome> {
  const resume = await getTailoredResume(userId, jobId);
  if (!resume) return { ok: false, message: "Tailor this job's resume first." };
  if (resume.pdfPath) return { ok: true, pdf: true, message: "PDF is ready." };
  return compileAndStore(userId, jobId, resume.tex);
}
