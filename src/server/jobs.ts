import {
  and,
  asc,
  eq,
  inArray,
  lt,
  notInArray,
  sql,
  type AnyColumn,
} from "drizzle-orm";

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

/** Removes the keyword and the jobs it found. */
export async function removeKeyword(userId: string, keywordId: number) {
  await db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(jobKeywords)
      .where(and(eq(jobKeywords.id, keywordId), eq(jobKeywords.userId, userId)))
      .returning({ keyword: jobKeywords.keyword });
    if (removed) {
      await tx
        .delete(jobs)
        .where(and(eq(jobs.userId, userId), eq(jobs.keyword, removed.keyword)));
    }
  });
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
 * Only jobs found by one of the user's *current* keywords are shown, so a
 * removed keyword's results disappear even if some rows outlived the removal
 * (e.g. a refresh that was still running when the keyword was removed).
 */
export async function getJobFeed(userId: string, limit = 100) {
  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        inArray(jobs.keyword, currentKeywords(userId)),
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
 * Tavily → upsert the results into the `job` table → drop anything from a
 * previous search that wasn't found again (likely expired / no longer
 * advertised) → drop jobs belonging to keywords the user has since removed.
 */
export async function refreshJobsForUser(userId: string) {
  const keywords = await getKeywords(userId);
  if (keywords.length === 0) {
    return { saved: 0, removed: 0, errors: ["Add at least one job title first."] };
  }

  let saved = 0;
  let removed = 0;
  const errors: string[] = [];
  const runStartedAt = new Date();

  for (const { keyword } of keywords) {
    const { results, succeeded, errors: searchErrors } = await searchJobs(keyword);
    errors.push(...searchErrors.map((e) => `"${keyword}" — ${e}`));

    if (results.length > 0) {
      // Dedupe within this batch (Postgres rejects an upsert that hits the same row twice).
      const unique = [...new Map(results.map((r) => [r.url, r])).values()];

      await db
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
        });
      saved += unique.length;
    }

    // Prune stale results — but only for boards whose search actually
    // succeeded, so a Tavily hiccup doesn't wipe a board's jobs.
    if (succeeded.length > 0) {
      const stale = await db
        .delete(jobs)
        .where(
          and(
            eq(jobs.userId, userId),
            eq(jobs.keyword, keyword),
            inArray(jobs.source, succeeded),
            lt(jobs.fetchedAt, runStartedAt),
          ),
        )
        .returning({ id: jobs.id });
      removed += stale.length;
    }
  }

  // Drop jobs whose keyword is no longer tracked. Catches rows inserted by
  // this run for a keyword the user removed while the search was in flight.
  await db
    .delete(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        notInArray(jobs.keyword, currentKeywords(userId)),
      ),
    );

  return { saved, removed, errors };
}
