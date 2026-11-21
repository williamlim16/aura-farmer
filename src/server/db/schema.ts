// Example model schema from the Drizzle docs
// https://orm.drizzle.team/docs/sql-schema-declaration

import { index, pgTableCreator, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `aura-farmer_${name}`);

export const posts = createTable(
  "post",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    name: d.varchar({ length: 256 }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [index("name_idx").on(t.name)],
);

/**
 * Job titles / search terms a user wants to be matched against.
 * `userId` is the Supabase auth user id (the JWT `sub` claim).
 *
 * RLS is enabled with no policies, so these tables are not reachable through
 * Supabase's public REST API — only through our server via DATABASE_URL.
 */
export const jobKeywords = createTable(
  "job_keyword",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    userId: d.uuid().notNull(),
    keyword: d.varchar({ length: 120 }).notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [uniqueIndex("job_keyword_user_keyword_idx").on(t.userId, t.keyword)],
).enableRLS();

/** Job postings found by Tavily for a user's keywords. One row per (user, url). */
export const jobs = createTable(
  "job",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    userId: d.uuid().notNull(),
    /** The keyword that produced this result. */
    keyword: d.varchar({ length: 120 }).notNull(),
    /** "seek" | "indeed" | "linkedin" */
    source: d.varchar({ length: 32 }).notNull(),
    title: d.text().notNull(),
    url: d.text().notNull(),
    snippet: d.text(),
    /** Tavily relevance score, 0–1. */
    score: d.real(),
    publishedAt: d.timestamp({ withTimezone: true }),
    fetchedAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [
    uniqueIndex("job_user_url_idx").on(t.userId, t.url),
    index("job_user_fetched_idx").on(t.userId, t.fetchedAt),
  ],
).enableRLS();
