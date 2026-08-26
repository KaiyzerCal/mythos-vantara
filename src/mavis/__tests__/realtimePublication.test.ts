// Drift guard between the tables the client subscribes to and the tables the
// migration publishes.
//
// This exists because of a bug that produced no error anywhere. AppDataContext
// subscribed to postgres_changes on sixteen tables; none of them were in the
// supabase_realtime publication, so not one subscription ever delivered an
// event. Realtime was dead code for as long as it had existed, and the only
// symptom was the app feeling stale after MAVIS acted — which someone
// compensated for with a double refetchAll rather than by finding this.
//
// A subscription to an unpublished table fails silently, and a published table
// nobody subscribes to is wasted WAL. Both directions are checked.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const CONTEXT = read("src/contexts/AppDataContext.tsx");
const MIGRATION = read("supabase/migrations/20260822140000_enable_realtime_publication.sql");
const CHAT = read("src/pages/MavisChat.tsx");

/** Tables the client opens a postgres_changes subscription on. */
function subscribedTables(): string[] {
  return [...CONTEXT.matchAll(/table:\s*"([a-z_]+)"\s*\}/g)].map((m) => m[1]);
}

/** Tables the migration adds to the publication. */
function publishedTables(): string[] {
  const start = MIGRATION.indexOf("FOREACH t IN ARRAY ARRAY[");
  expect(start, "could not find the table array in the migration").toBeGreaterThan(-1);
  const body = MIGRATION.slice(start, MIGRATION.indexOf("]", start));
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe("realtime subscriptions and publication agree", () => {
  it("the client subscribes to a non-trivial set of tables", () => {
    expect(subscribedTables().length).toBeGreaterThanOrEqual(16);
  });

  it("every subscribed table is published, or its subscription is inert", () => {
    const published = publishedTables();
    for (const t of subscribedTables()) {
      expect(
        published,
        `AppDataContext subscribes to "${t}" but the migration never publishes it — ` +
        `that subscription will never fire, with no error anywhere`,
      ).toContain(t);
    }
  });

  it("every published table is actually subscribed to, or it is wasted WAL", () => {
    const subscribed = subscribedTables();
    for (const t of publishedTables()) {
      expect(
        subscribed,
        `the migration publishes "${t}" but nothing subscribes to it`,
      ).toContain(t);
    }
  });

  it("publishes each table exactly once", () => {
    const published = publishedTables();
    expect(new Set(published).size).toBe(published.length);
  });
});

describe("the migration is safe to run and to re-run", () => {
  it("sets a lock_timeout before any DDL", () => {
    // The rule from the 2026-08-22 auth incident: a DDL statement that waits
    // for a lock blocks every query queued behind it.
    //
    // Comments are stripped first — this file explains ALTER PUBLICATION's
    // locking behaviour in its header, and matching that prose instead of the
    // statement made this assertion fail on a correct migration.
    const sql = MIGRATION.replace(/--[^\n]*/g, "");
    const lockIdx = sql.indexOf("SET lock_timeout");
    const ddlIdx = sql.indexOf("ALTER PUBLICATION");
    expect(lockIdx, "no lock_timeout set").toBeGreaterThan(-1);
    expect(ddlIdx, "no ALTER PUBLICATION found").toBeGreaterThan(-1);
    expect(ddlIdx, "DDL runs before lock_timeout is set").toBeGreaterThan(lockIdx);
  });

  it("skips tables already in the publication", () => {
    // ALTER PUBLICATION ... ADD TABLE errors on a duplicate, so without this
    // a partially-applied run could never be repeated.
    expect(MIGRATION).toMatch(/pg_publication_tables/);
    expect(MIGRATION).toMatch(/CONTINUE;/);
  });

  it("skips a missing table instead of aborting the batch", () => {
    expect(MIGRATION).toMatch(/pg_tables/);
  });
});

describe("the compensating refetches are gone", () => {
  it("no longer refetches everything twice", () => {
    // `await refetchAll(); setTimeout(() => refetchAll(), 1500);` was the
    // signature of realtime being inert. Its return would mean the underlying
    // problem came back.
    expect(CHAT).not.toMatch(/setTimeout\(\s*\(\)\s*=>\s*\{?\s*refetchAll/);
  });

  it("no longer sleeps before refreshing", () => {
    // Sleeps before a refetch were there to let writes land before a poll
    // could see them — push does not need them.
    expect(CHAT).not.toMatch(/await new Promise\(\s*\(?r\)?\s*=>\s*setTimeout\(r,\s*500\)\s*\);\s*\n\s*(invalidateSystemPromptCache\(\);\s*\n\s*)?await refetchAll/);
  });

  it("still refreshes after actions, as a backstop", () => {
    // Realtime is primary, but it has never run in production — removing the
    // fallback entirely would bet the UI on untested infrastructure.
    expect(CHAT).toMatch(/await refetchAll\(\)/);
  });
});
