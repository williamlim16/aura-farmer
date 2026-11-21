import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  max,
  sql,
  type AnyColumn,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  DEFAULT_TRACKING_STATUS,
  normalizeTrackingStatus,
  type TrackingStatus,
} from "~/lib/tracking-status";
import { db } from "~/server/db";
import { jobKeywords, jobs, trackedJobs } from "~/server/db/schema";
import { SOURCE_ORDER, type JobSource } from "~/server/job-boards";
import { fetchDescriptions } from "~/server/job-descriptions";
import { searchJobs } from "~/server/tavily";

/** `excluded.<column>` — the incoming value in an ON CONFLICT DO UPDATE. */
const excluded = (column: AnyColumn) => sql.raw(`excluded."${column.name}"`);

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
 * Each board is sorted newest-first — by posted date, then posting id (higher
 * = newer) — and the boards are interleaved: newest Seek, newest LinkedIn,
 * an Indeed job, 2nd-newest Seek, … Indeed cards carry no date, so Indeed
 * jobs keep the board's own relevance order.
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
        (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) ||
        (b.postingId ?? -1) - (a.postingId ?? -1),
    );
  }

  const order = [
    ...SOURCE_ORDER,
    ...[...bySource.keys()].filter(
      (s) => !SOURCE_ORDER.includes(s as JobSource),
    ),
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
 * Every job ever stored for the user — including results from older searches
 * and keywords they no longer track — most recently found first. Backs the
 * "All jobs" table; unlike `getJobFeed`, nothing is filtered out.
 */
export function getAllJobs(userId: string) {
  return db
    .select({
      id: jobs.id,
      title: jobs.title,
      url: jobs.url,
      source: jobs.source,
      keyword: jobs.keyword,
      company: jobs.company,
      location: jobs.location,
      snippet: jobs.snippet,
      description: jobs.description,
      descriptionAttempts: jobs.descriptionAttempts,
      publishedAt: jobs.publishedAt,
      fetchedAt: jobs.fetchedAt,
    })
    .from(jobs)
    .where(eq(jobs.userId, userId))
    .orderBy(desc(jobs.fetchedAt), desc(jobs.publishedAt), desc(jobs.id));
}

/** Give up on a posting's description after this many failed fetches. */
export const MAX_DESCRIPTION_ATTEMPTS = 3;
/** Postings fetched per "Fetch descriptions" batch (keeps each request short). */
const DESCRIPTION_BATCH = 30;
/** Most descriptions fetched as part of one "Find jobs" run. */
const REFRESH_DESCRIPTION_LIMIT = 150;

/** Jobs that have no description yet and are still worth trying. */
function missingDescription(userId: string, fetchedAt?: Date) {
  return and(
    eq(jobs.userId, userId),
    fetchedAt ? eq(jobs.fetchedAt, fetchedAt) : undefined,
    isNull(jobs.description),
    lt(jobs.descriptionAttempts, MAX_DESCRIPTION_ATTEMPTS),
  );
}

/**
 * Fetch descriptions for the next batch of the user's jobs that don't have
 * one, newest first. Call repeatedly until `remaining` is 0 (or a batch
 * makes no progress). A posting that loads without a description (expired)
 * is given up on immediately; one that fails to load is retried on later
 * calls, up to MAX_DESCRIPTION_ATTEMPTS.
 *
 * `fetchedAt` limits it to the jobs saved by one refresh run.
 */
export async function fetchMissingDescriptions(
  userId: string,
  {
    limit = DESCRIPTION_BATCH,
    fetchedAt,
  }: { limit?: number; fetchedAt?: Date } = {},
) {
  const batch = await db
    .select({
      id: jobs.id,
      source: jobs.source,
      url: jobs.url,
      title: jobs.title,
    })
    .from(jobs)
    .where(missingDescription(userId, fetchedAt))
    .orderBy(asc(jobs.descriptionAttempts), desc(jobs.fetchedAt), desc(jobs.id))
    .limit(limit);

  const results = await fetchDescriptions(batch);

  let found = 0;
  await Promise.all(
    batch.map(({ id }) => {
      const result = results.get(id) ?? { status: "failed" as const };
      if (result.status === "found") found++;
      return db
        .update(jobs)
        .set(
          result.status === "found"
            ? { description: result.description }
            : result.status === "missing"
              ? { descriptionAttempts: MAX_DESCRIPTION_ATTEMPTS }
              : { descriptionAttempts: sql`${jobs.descriptionAttempts} + 1` },
        )
        .where(and(eq(jobs.id, id), eq(jobs.userId, userId)));
    }),
  );

  const [{ remaining } = { remaining: 0 }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(jobs)
    .where(missingDescription(userId));

  return { attempted: batch.length, found, remaining };
}

/** Map of tracked job IDs to their application pipeline status. */
export async function getTrackedJobStatuses(
  userId: string,
): Promise<Map<number, TrackingStatus>> {
  const rows = await db
    .select({ jobId: trackedJobs.jobId, status: trackedJobs.status })
    .from(trackedJobs)
    .where(eq(trackedJobs.userId, userId));
  return new Map(rows.map((r) => [r.jobId, normalizeTrackingStatus(r.status)]));
}

/** Set of job IDs currently saved in the user's tracking shortlist. */
export async function getTrackedJobIds(userId: string): Promise<Set<number>> {
  const rows = await db
    .select({ jobId: trackedJobs.jobId })
    .from(trackedJobs)
    .where(eq(trackedJobs.userId, userId));
  return new Set(rows.map((r) => r.jobId));
}

/**
 * Deduplicated shortlist of tracked jobs for a user, ordered most recently
 * tracked first.
 */
export function getTrackedJobs(userId: string) {
  return db
    .select({
      id: jobs.id,
      title: jobs.title,
      url: jobs.url,
      source: jobs.source,
      keyword: jobs.keyword,
      company: jobs.company,
      location: jobs.location,
      snippet: jobs.snippet,
      description: jobs.description,
      publishedAt: jobs.publishedAt,
      fetchedAt: jobs.fetchedAt,
      trackedAt: trackedJobs.createdAt,
      trackingStatus: trackedJobs.status,
    })
    .from(trackedJobs)
    .innerJoin(
      jobs,
      and(eq(trackedJobs.jobId, jobs.id), eq(jobs.userId, userId)),
    )
    .where(eq(trackedJobs.userId, userId))
    .orderBy(desc(trackedJobs.createdAt), desc(trackedJobs.id));
}

/**
 * Adds or removes jobs from the user's tracking shortlist.
 * Enforces ownership on `jobs` and deduplicates via `(userId, jobId)`.
 */
export async function setJobsTracked(
  userId: string,
  jobIds: number[],
  tracked: boolean,
  status: TrackingStatus = DEFAULT_TRACKING_STATUS,
) {
  const uniqueIds = [...new Set(jobIds)];
  if (uniqueIds.length === 0) return;

  if (tracked) {
    const owned = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.userId, userId), inArray(jobs.id, uniqueIds)));
    if (owned.length === 0) return;

    await db
      .insert(trackedJobs)
      .values(owned.map((row) => ({ userId, jobId: row.id, status })))
      .onConflictDoNothing({
        target: [trackedJobs.userId, trackedJobs.jobId],
      });
    return;
  }

  await db
    .delete(trackedJobs)
    .where(
      and(
        eq(trackedJobs.userId, userId),
        inArray(trackedJobs.jobId, uniqueIds),
      ),
    );
}

/**
 * Updates the pipeline status for one or more jobs, adding them to the user's
 * tracking shortlist if they are not already tracked.
 */
export async function setJobTrackingStatus(
  userId: string,
  jobIds: number[],
  status: TrackingStatus,
) {
  const uniqueIds = [...new Set(jobIds)];
  if (uniqueIds.length === 0) return;

  const owned = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.userId, userId), inArray(jobs.id, uniqueIds)));
  if (owned.length === 0) return;

  await db
    .insert(trackedJobs)
    .values(owned.map((row) => ({ userId, jobId: row.id, status })))
    .onConflictDoUpdate({
      target: [trackedJobs.userId, trackedJobs.jobId],
      set: { status },
    });
}

/**
 * Pipeline: read the user's keywords from the DB → fetch each board's
 * recent-listings page via Tavily Extract (all keywords in parallel) →
 * upsert the results into the `job` table.
 *
 * Nothing is deleted. Each posting is stored once per user (unique on
 * user + url): a posting found again is updated in place — fresh details,
 * the keyword that found it, and a new `fetchedAt` — rather than duplicated.
 */
export async function refreshJobsForUser(userId: string) {
  const keywords = await getKeywords(userId);
  if (keywords.length === 0) {
    return {
      saved: 0,
      added: 0,
      descriptions: 0,
      errors: ["Add at least one job title first."],
    };
  }

  let saved = 0;
  let added = 0;
  const errors: string[] = [];
  const runStartedAt = new Date();

  // Each extract takes ~10–15s, so search all keywords at once.
  const searches = await Promise.all(
    keywords.map(async ({ keyword }) => ({
      keyword,
      ...(await searchJobs(keyword)),
    })),
  );

  for (const { keyword, results, errors: searchErrors } of searches) {
    errors.push(...searchErrors.map((e) => `"${keyword}" — ${e}`));

    if (results.length > 0) {
      // Dedupe within this batch (Postgres rejects an upsert that hits the same row twice).
      const unique = [...new Map(results.map((r) => [r.url, r])).values()];

      const upserted = await db
        .insert(jobs)
        .values(
          unique.map((r) => ({
            ...r,
            userId,
            keyword,
            fetchedAt: runStartedAt,
          })),
        )
        .onConflictDoUpdate({
          target: [jobs.userId, jobs.url],
          set: {
            title: excluded(jobs.title),
            company: excluded(jobs.company),
            location: excluded(jobs.location),
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

  // Fetch descriptions for this run's jobs that don't have one yet. Jobs
  // found before keep theirs, so a re-run only fetches the new postings.
  // Anything that fails here is picked up by "Fetch descriptions" later.
  let descriptions = 0;
  if (saved > 0) {
    try {
      ({ found: descriptions } = await fetchMissingDescriptions(userId, {
        limit: REFRESH_DESCRIPTION_LIMIT,
        fetchedAt: runStartedAt,
      }));
    } catch (err) {
      console.error("Fetching descriptions after refresh failed", err);
    }
  }

  return { saved, added, descriptions, errors };
}
