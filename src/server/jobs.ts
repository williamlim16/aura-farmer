import { and, asc, eq, inArray, max, sql, type AnyColumn } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "~/server/db";
import { jobKeywords, jobs } from "~/server/db/schema";
import { searchJobs, SOURCE_ORDER, type JobSource } from "~/server/tavily";

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

/** Subquery of the user's current keywords, for filtering `jobs.keyword`. */
function currentKeywords(userId: string) {
  return db
    .select({ keyword: jobKeywords.keyword })
    .from(jobKeywords)
    .where(eq(jobKeywords.userId, userId));
}

export async function addKeyword(userId: string, keyword: string) {
  await db
    .insert(jobKeywords)
    .values({ userId, keyword })
    .onConflictDoNothing({ target: [jobKeywords.userId, jobKeywords.keyword] });
}

/**
 * Stops tracking a keyword. The jobs it found stay in the database (job data
 * is never deleted); they just drop out of the feed — see `getJobFeed`.
 */
export async function removeKeyword(userId: string, keywordId: number) {
  await db
    .delete(jobKeywords)
    .where(and(eq(jobKeywords.id, keywordId), eq(jobKeywords.userId, userId)));
}

/**
 * The user's feed, most recently posted first.
 *
 * Tavily gives us no posted date, so recency comes from each board's posting
 * id (higher = newer). Ids from different boards aren't comparable, so we sort
 * each board newest-first and interleave them: newest Seek, newest LinkedIn,
 * an Indeed search, 2nd-newest Seek, … Rows without an id (Indeed search
 * pages) keep Tavily's relevance order.
 *
 * Job rows are never deleted, so the feed filters what it shows:
 * - only jobs whose keyword the user currently tracks, and
 * - for each (keyword, board), only the jobs from its most recent search —
 *   i.e. rows with that pair's latest `fetchedAt`. Older results (likely
 *   expired postings) stay in the DB but are hidden. A board whose search
 *   fails doesn't get new rows, so its previous results keep showing.
 */
export async function getJobFeed(userId: string, limit = 100) {
  const latest = alias(jobs, "latest");
  const latestFetchedAt = db
    .select({ at: max(latest.fetchedAt) })
    .from(latest)
    .where(
      and(
        eq(latest.userId, jobs.userId),
        eq(latest.keyword, jobs.keyword),
        eq(latest.source, jobs.source),
      ),
    );

  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        inArray(jobs.keyword, currentKeywords(userId)),
        eq(jobs.fetchedAt, sql`(${latestFetchedAt})`),
      ),
    );

  const bySource = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = bySource.get(row.source) ?? [];
    list.push(row);
    bySource.set(row.source, list);
  }
  for (const list of bySource.values()) {
    list.sort(
      (a, b) =>
        (b.postingId ?? -1) - (a.postingId ?? -1) ||
        (b.score ?? 0) - (a.score ?? 0),
    );
  }

  const order = [
    ...SOURCE_ORDER,
    ...[...bySource.keys()].filter((s) => !SOURCE_ORDER.includes(s as JobSource)),
  ];
  const feed: typeof rows = [];
  for (let i = 0; feed.length < rows.length; i++) {
    for (const source of order) {
      const row = bySource.get(source)?.[i];
      if (row) feed.push(row);
    }
  }
  return feed.slice(0, limit);
}

/**
 * Pipeline: read the user's keywords from the DB → search the job boards via
 * Tavily → upsert the results into the `job` table.
 *
 * Nothing is deleted. Each posting is stored once per user (unique on
 * user + url): a posting found again is updated in place — fresh details,
 * the keyword that found it, and a new `fetchedAt` — rather than duplicated.
 */
export async function refreshJobsForUser(userId: string) {
  const keywords = await getKeywords(userId);
  if (keywords.length === 0) {
    return { saved: 0, added: 0, errors: ["Add at least one job title first."] };
  }

  let saved = 0;
  let added = 0;
  const errors: string[] = [];
  const runStartedAt = new Date();

  for (const { keyword } of keywords) {
    const { results, errors: searchErrors } = await searchJobs(keyword);
    errors.push(...searchErrors.map((e) => `"${keyword}" — ${e}`));

    if (results.length > 0) {
      // Dedupe within this batch (Postgres rejects an upsert that hits the same row twice).
      const unique = [...new Map(results.map((r) => [r.url, r])).values()];

      const upserted = await db
        .insert(jobs)
        .values(unique.map((r) => ({ ...r, userId, keyword, fetchedAt: runStartedAt })))
        .onConflictDoUpdate({
          target: [jobs.userId, jobs.url],
          set: {
            title: excluded(jobs.title),
            snippet: excluded(jobs.snippet),
            score: excluded(jobs.score),
            keyword: excluded(jobs.keyword),
            postingId: excluded(jobs.postingId),
            publishedAt: excluded(jobs.publishedAt),
            fetchedAt: excluded(jobs.fetchedAt),
          },
        })
        // Postgres sets xmax = 0 on freshly inserted rows, non-zero on updates.
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      saved += unique.length;
      added += upserted.filter((r) => r.inserted).length;
    }
  }

  return { saved, added, errors };
}
