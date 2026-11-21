/**
 * Regression test for the local dev database server: many concurrent
 * postgres-js connections issuing parameterised (extended protocol) queries
 * and transactions must not interfere. This failed with per-message
 * multiplexing ("bind message supplies 1 parameters, but prepared statement
 * requires 2").
 */
import postgres from "postgres";
import { afterAll, beforeAll, expect, it } from "vitest";

import { startDevDb } from "../../scripts/dev/db";

let db: Awaited<ReturnType<typeof startDevDb>>;
beforeAll(async () => {
  db = await startDevDb({ dir: "memory://", port: 0 });
});
afterAll(async () => db?.stop());

it("serves concurrent parameterised queries from several pools correctly", async () => {
  const pools = [postgres(db.url, { max: 4 }), postgres(db.url, { max: 4 }), postgres(db.url, { max: 4 })];
  try {
    const jobs = Array.from({ length: 60 }, (_, i) => {
      const sql = pools[i % pools.length]!;
      return i % 2 ? sql`select ${i}::int as a, ${"x" + i}::text as b` : sql`select ${i}::int as a`;
    });
    const rows = await Promise.all(jobs);
    rows.forEach((r, i) => expect(r[0]!.a).toBe(i));
  } finally {
    await Promise.all(pools.map((p) => p.end()));
  }
});

it("keeps transactions isolated to their connection", async () => {
  const a = postgres(db.url, { max: 1 });
  const b = postgres(db.url, { max: 1 });
  try {
    await a`create table if not exists t (v int)`;
    const tx = a.begin(async (sql) => {
      await sql`insert into t values (1)`;
      await new Promise((r) => setTimeout(r, 100));
      await sql`insert into t values (2)`;
    });
    const other = b`select count(*)::int as n from t`;
    const [, [row]] = await Promise.all([tx, other]);
    expect([0, 2]).toContain(row!.n); // never sees a half-finished transaction
  } finally {
    await a.end();
    await b.end();
  }
});

it("keeps describe-then-execute rounds from different pools apart", async () => {
  // postgres-js describes unknown parameter types first, then binds in a second round.
  const pools = Array.from({ length: 4 }, () => postgres(db.url, { max: 3 }));
  try {
    const jobs = Array.from({ length: 80 }, (_, i) => {
      const sql = pools[i % pools.length]!;
      const n = (i % 3) + 1;
      if (n === 1) return sql`select ${i} as a`.then((r) => Number(r[0]!.a));
      if (n === 2) return sql`select ${i} as a, ${"x"} as b`.then((r) => Number(r[0]!.a));
      return sql`select ${i} as a, ${"x"} as b, ${true} as c`.then((r) => Number(r[0]!.a));
    });
    expect(await Promise.all(jobs)).toEqual(Array.from({ length: 80 }, (_, i) => i));
  } finally {
    await Promise.all(pools.map((p) => p.end()));
  }
});
