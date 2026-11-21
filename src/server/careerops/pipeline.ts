~ `import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { applyRuns } from "~/server/db/schema";
import { cachedText, callStructured, text } from "./claude";
import { resolveJob, type ResolvedJob } from "./jobs";
import {
  RESUME_EXTRACTION_PROMPT,
  draftingSystemPrompt,
  evaluationSystemPrompt,
} from "./prompts";
import {
  ApplicationDraft,
  Evaluation,
  ResumeExtraction,
  type JobInput,
} from "./schemas";

/** career-ops' "Apply" band starts at 4.0/5 (career-ops/lib/score-action.mjs). Below it, no drafts. */
export const APPLY_MIN_SCORE = 4.0;
/** Cap on drafted applications per run: career-ops' "apply better to fewer". */
const MAX_DRAFTS = 5;
/** How many Claude calls run at once. */
const CONCURRENCY = 3;

export type ResumeUpload =
  | { kind: "pdf"; base64: string }
  | { kind: "text"; text: string };

export type ApplyInput = { jobs: JobInput[]; preferences: string | null };

export type RankedJob = {
  rank: number;
  job: Omit<ResolvedJob, "description">;
  evaluation: Evaluation;
  application: ApplicationDraft | null;
  applicationError: string | null;
};

export type ApplyResult = {
  candidateName: string;
  ranked: RankedJob[];
  failedJobs: { input: JobInput; error: string }[];
  note: string;
};

/**
 * The career-ops loop, adapted to run without a CLI:
 *   1. resume -> cv.md-style markdown
 *   2. each job -> job description text
 *   3. evaluate each job (modes/oferta.md + modes/_shared.md) -> 1-5 score + report
 *   4. rank by score
 *   5. for jobs at or above the Apply band: tailored CV + cover letter (modes/text.md, modes/cover.md)
 * Progress and results are written to the apply_run row as it goes.
 */
export async function runApplyLoop(runId: string, resume: ResumeUpload, input: ApplyInput) {
  try {
    // 1. Resume -------------------------------------------------------------
    await setStatus(runId, "extracting_resume", "Reading the resume");
    const { candidateName, cvMarkdown } = await extractResume(resume);
    await db.update(applyRuns).set({ resumeMarkdown: cvMarkdown }).where(eq(applyRuns.id, runId));

    // The CV + preferences block is identical for every job in this run, so it
    // is marked cacheable: after the first call, later calls reuse it cheaply.
    const candidateBlock = cachedText(
      `<cv>\n${cvMarkdown}\n</cv>\n\n<preferences>\n${input.preferences ?? "None stated."}\n</preferences>`,
    );

    // 2. Job descriptions ---------------------------------------------------
    await setStatus(runId, "fetching_jobs", `Fetching ${input.jobs.length} job descriptions`);
    const failedJobs: ApplyResult["failedJobs"] = [];
    const resolved: { input: JobInput; job: ResolvedJob }[] = [];
    const fetched = await Promise.allSettled(input.jobs.map(resolveJob));
    fetched.forEach((r, i) => {
      const jobInput = input.jobs[i]!;
      if (r.status === "fulfilled") resolved.push({ input: jobInput, job: r.value });
      else failedJobs.push({ input: jobInput, error: errorMessage(r.reason) });
    });

    // 3. Evaluate -----------------------------------------------------------
    let done = 0;
    await setStatus(runId, "evaluating", `Evaluating 0 of ${resolved.length} jobs`);
    const evalSystem = [cachedText(evaluationSystemPrompt())];
    const evaluated = await mapWithConcurrency(resolved, CONCURRENCY, async ({ input: jobInput, job }) => {
      try {
        const evaluation = await callStructured({
          schema: Evaluation,
          system: evalSystem,
          content: [candidateBlock, text(jobDescriptionBlock(job))],
          effort: "high",
        });
        return { job, evaluation };
      } catch (err) {
        failedJobs.push({ input: jobInput, error: errorMessage(err) });
        return null;
      } finally {
        done++;
        await setStatus(runId, "evaluating", `Evaluating ${done} of ${resolved.length} jobs`);
      }
    });

    // 4. Rank ---------------------------------------------------------------
    const ranked: RankedJob[] = evaluated
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .sort((a, b) => b.evaluation.score - a.evaluation.score)
      .map(({ job, evaluation }, i) => ({
        rank: i + 1,
        job: { url: job.url, company: job.company, title: job.title },
        evaluation,
        application: null,
        applicationError: null,
      }));

    // 5. Draft applications for the jobs worth applying to ------------------
    const descriptions = new Map(evaluated.flatMap((e) => (e ? [[e.evaluation, e.job.description]] : [])));
    const worthApplying = ranked
      .filter((r) => r.evaluation.score >= APPLY_MIN_SCORE && r.evaluation.recommendation !== "skip")
      .slice(0, MAX_DRAFTS);

    await setStatus(runId, "drafting", `Drafting ${worthApplying.length} applications`);
    const draftSystem = [cachedText(draftingSystemPrompt())];
    await mapWithConcurrency(worthApplying, CONCURRENCY, async (r) => {
      try {
        r.application = await callStructured({
          schema: ApplicationDraft,
          system: draftSystem,
          content: [
            candidateBlock,
            text(
              `<evaluation_report>\n${r.evaluation.reportMarkdown}\n</evaluation_report>\n\n` +
                jobDescriptionBlock({ ...r.job, description: descriptions.get(r.evaluation) ?? "" }) +
                "\n\nDraft the tailored CV, cover letter, and the 'why this role' answer for this job.",
            ),
          ],
          effort: "medium",
        });
      } catch (err) {
        r.applicationError = errorMessage(err);
      }
    });

    const result: ApplyResult = {
      candidateName,
      ranked,
      failedJobs,
      note:
        worthApplying.length === 0
          ? `No job scored ${APPLY_MIN_SCORE}/5 or higher, so no applications were drafted. career-ops recommends against applying below that.`
          : "Drafts only. Review every tailored CV and letter before you submit anything yourself.",
    };
    await db
      .update(applyRuns)
      .set({ status: "done", progress: null, result })
      .where(eq(applyRuns.id, runId));
  } catch (err) {
    console.error(`apply run ${runId} failed`, err);
    await db
      .update(applyRuns)
      .set({ status: "failed", error: errorMessage(err) })
      .where(eq(applyRuns.id, runId));
  }
}

async function extractResume(resume: ResumeUpload) {
  return callStructured({
    schema: ResumeExtraction,
    system: [text(RESUME_EXTRACTION_PROMPT)],
    content:
      resume.kind === "pdf"
        ? [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: resume.base64 },
            },
            text("Convert this resume."),
          ]
        : [text(`<resume>\n${resume.text}\n</resume>\n\nConvert this resume.`)],
    effort: "low",
    maxTokens: 32_000,
  });
}

function jobDescriptionBlock(job: ResolvedJob): string {
  const meta = [
    job.url && `URL: ${job.url}`,
    job.company && `Company (as given by the caller): ${job.company}`,
    job.title && `Title (as given by the caller): ${job.title}`,
  ]
    .filter(Boolean)
    .join("\n");
  return `<job_description>\n${meta}\n\n${job.description}\n</job_description>`;
}

async function setStatus(runId: string, status: string, progress: string) {
  await db.update(applyRuns).set({ status, progress }).where(eq(applyRuns.id, runId));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Like Promise.all(items.map(fn)), but at most `limit` calls run at the same time. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
