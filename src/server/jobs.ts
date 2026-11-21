import { and, asc, desc, eq, sql, type AnyColumn } from "drizzle-orm";

import { db } from "~/server/db";
import { jobKeywords, jobs } from "~/server/db/schema";
import { searchJobs } from "~/server/tavily";

/** `excluded.<column>` — the incoming value in an ON CONFLICT DO UPDATE. */
const excluded = (column: AnyColumn) =>
  sql.raw(`excluded."${column.name}"`);

/** Hard cap so one refresh can't fan out into hundreds of Tavily calls. */
export const MAX_KEYWORDS = 10;

export function getKeywords(userId: string) {
  return db
    .select()
    .from(jobKeywords)
    .where(eq(jobKeywords.userId, userId))
    .orderBy(asc(jobKeywords.createdAt));
}

export async function addKeyword(userId: string, keyword: string) {
  await db
    .insert(jobKeywords)
    .values({ userId, keyword })
    .onConflictDoNothing({ target: [jobKeywords.userId, jobKeywords.keyword] });
}

export async function removeKeyword(userId: string, keywordId: number) {
  await db
    .delete(jobKeywords)
    .where(and(eq(jobKeywords.id, keywordId), eq(jobKeywords.userId, userId)));
}

export function getJobFeed(userId: string, limit = 100) {
  return db
    .select()
    .from(jobs)
    .where(eq(jobs.userId, userId))
    .orderBy(desc(jobs.fetchedAt), desc(jobs.score))
    .limit(limit);
}

/**
 * Pipeline: read the user's keywords from the DB → search the job boards via
 * Tavily → upsert the results into the `job` table.
 */
export async function refreshJobsForUser(userId: string) {
  const keywords = await getKeywords(userId);
  if (keywords.length === 0) {
    return { saved: 0, errors: ["Add at least one job title first."] };
  }

  let saved = 0;
  const errors: string[] = [];

  for (const { keyword } of keywords) {
    const { results, errors: searchErrors } = await searchJobs(keyword);
    errors.push(...searchErrors.map((e) => `"${keyword}" — ${e}`));
    if (results.length === 0) continue;

    // Dedupe within this batch (Postgres rejects an upsert that hits the same row twice).
    const unique = [...new Map(results.map((r) => [r.url, r])).values()];

    const now = new Date();
    await db
      .insert(jobs)
      .values(unique.map((r) => ({ ...r, userId, keyword, fetchedAt: now })))
      .onConflictDoUpdate({
        target: [jobs.userId, jobs.url],
        set: {
          title: excluded(jobs.title),
          snippet: excluded(jobs.snippet),
          score: excluded(jobs.score),
          keyword: excluded(jobs.keyword),
          publishedAt: excluded(jobs.publishedAt),
          fetchedAt: excluded(jobs.fetchedAt),
        },
      });
    saved += unique.length;
  }

  return { saved, errors };
}
