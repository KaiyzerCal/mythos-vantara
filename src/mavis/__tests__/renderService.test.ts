// Drift guard for the render service and the render_jobs table it owns.
//
// render-service/ is a plain Node project outside this repo's Deno functions
// and outside the vitest workspace's own source tree — nothing type-checks
// its column names against the migration, and (unlike the Deno functions)
// there is no `deno check` gate for it in CI either. A typo here fails inside
// a background render, where the only symptom is a production stuck on
// "rendering" forever. Same static-verification approach as
// videoSchemaSync.test.ts, adapted for a table this migration was the first
// to introduce entirely outside supabase/functions/.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const MIGRATION = read("supabase/migrations/20260827180000_render_jobs.sql");
const SERVER = read("render-service/server.mjs");
const HYPERFRAMES = read("supabase/functions/mavis-hyperframes/index.ts");

/** Column names declared for the render_jobs CREATE TABLE block. */
function renderJobsColumns(): string[] {
  const start = MIGRATION.indexOf("CREATE TABLE IF NOT EXISTS public.render_jobs");
  expect(start, "render_jobs not found in the migration").toBeGreaterThan(-1);
  // Indent-agnostic for the same reason as videoSchemaSync's columnsOf: this
  // CREATE TABLE sits inside a DO block, so its indent and its closing paren
  // are not at a fixed column.
  const end = MIGRATION.slice(start).search(/^\s*\);/m);
  const body = MIGRATION.slice(start, end === -1 ? undefined : start + end);
  return [...body.matchAll(/^\s+([a-z_]+)\s+(?:uuid|text|timestamptz)\b/gm)].map((m) => m[1]);
}

/** Values of render_jobs' status CHECK constraint. */
function statusValues(): string[] {
  const m = MIGRATION.match(/status\s+text[^)]*?CHECK \(status IN \(([^)]+)\)/s);
  expect(m, "no CHECK (status IN (...)) found for render_jobs.status").not.toBeNull();
  return [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

describe("render_jobs: migration and server agree on columns", () => {
  const declared = renderJobsColumns();

  it("declares every column server.mjs reads or writes", () => {
    expect(declared.length).toBeGreaterThan(5);
    // Columns server.mjs actually touches, named literally rather than
    // derived by regex — a wrong name here is exactly the drift this test
    // exists to catch, so deriving it from the same source would hide bugs
    // rather than find them.
    for (const col of [
      "id", "user_id", "status", "output_path", "output_url", "error_message", "updated_at",
    ]) {
      expect(declared, `render_jobs has no "${col}" column`).toContain(col);
    }
  });

  it("server.mjs's status literals match the CHECK constraint exactly", () => {
    const statuses = statusValues();
    const used = new Set<string>();
    for (const m of SERVER.matchAll(/status:\s*"([a-z]+)"/g)) used.add(m[1]);
    expect([...used].sort()).toEqual([...statuses].sort());
  });
});

describe("the migration is safe and re-runnable", () => {
  it("sets lock_timeout inside the block, not only as a session SET", () => {
    expect(MIGRATION).toMatch(/set_config\('lock_timeout'[^)]*true\)/);
  });

  it("has no foreign key to auth.users", () => {
    // This table is written only via the service-role key, never via a user
    // JWT — user_id here is provenance for the storage path, not a relation
    // Postgres needs to enforce. Per CLAUDE.md's rule on auth.users: a table
    // with no reason to touch it shouldn't.
    //
    // Checks for an actual REFERENCES clause, not the bare substring
    // "auth.users" — this file's own header comment explains that absence in
    // prose, and matching prose instead of a statement is exactly the bug
    // realtimePublication.test.ts was written to avoid making twice.
    const code = MIGRATION.replace(/--[^\n]*/g, "");
    expect(code).not.toMatch(/REFERENCES\s+auth\.users/i);
  });

  it("enables RLS with no policies for authenticated or anon", () => {
    expect(MIGRATION).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(MIGRATION).not.toMatch(/CREATE POLICY/);
    expect(MIGRATION).toMatch(/GRANT ALL ON public\.render_jobs TO service_role/);
  });
});

describe("the server no longer promises what it can't keep", () => {
  it("does not require PUBLIC_URL", () => {
    // The old failure mode: PUBLIC_URL built a URL to a file this process
    // itself served, which is exactly the durability problem this rewrite
    // removed. A PUBLIC_URL requirement reappearing here means someone
    // reintroduced local-disk serving without reading why it was removed.
    expect(SERVER).not.toMatch(/PUBLIC_URL/);
  });

  it("has no /file route", () => {
    expect(SERVER).not.toMatch(/["'`]\/file/);
  });

  it("uploads to the same bucket and path convention as beat narration", () => {
    expect(SERVER).toMatch(/vault-media/);
    expect(SERVER).toMatch(/render-jobs\/\$\{jobId\}\.mp4/);
  });
});

/**
 * Both constants below can be written as a bare literal (`10_000`) or as a
 * product (`20 * 60 * 1000`) — server.mjs uses both forms, so the extraction
 * has to handle either. A regex that only matched `[\d_]+` would silently
 * truncate a product at its first `*`, returning a small-but-real-looking
 * number instead of failing — which is exactly how an earlier version of
 * this test passed while comparing the wrong values: the mutation that
 * raised DB_CALL_TIMEOUT_MS to `30 * 60 * 1000` (past the staleness window,
 * which the test below exists to catch) was parsed as `30`.
 */
function parseMsConstant(name: string): number {
  const expr = SERVER.match(new RegExp(`${name} = ([\\d_ *]+);`))?.[1];
  if (!expr) return NaN;
  return expr.split("*").map((n) => Number(n.trim().replace(/_/g, ""))).reduce((a, b) => a * b, 1);
}

describe("request-path Postgres calls are bounded", () => {
  it("the status poll and the job-creation insert both carry an abort signal", () => {
    // Regression pin for a hang that was verified against a real unreachable
    // Supabase URL, not assumed: GET /render/:id sat with zero bytes sent
    // until the caller's own 15s ceiling fired, because nothing on this side
    // bounded the Postgres call at all.
    const withSignal = [...SERVER.matchAll(/\.abortSignal\(AbortSignal\.timeout\(DB_CALL_TIMEOUT_MS\)\)/g)];
    expect(withSignal.length, "expected the select, the insert, and the reaper's update to all carry it")
      .toBeGreaterThanOrEqual(3);
  });

  it("the DB call timeout is shorter than the staleness window", () => {
    // Otherwise a single slow-but-not-hung Postgres round trip could outlast
    // the window that is supposed to mean "truly abandoned".
    const dbTimeout = parseMsConstant("DB_CALL_TIMEOUT_MS");
    const staleAfter = parseMsConstant("STALE_AFTER_MS");
    expect(dbTimeout, "could not find or evaluate DB_CALL_TIMEOUT_MS").toBeGreaterThan(0);
    expect(staleAfter, "could not find or evaluate STALE_AFTER_MS").toBeGreaterThan(0);
    expect(dbTimeout).toBeLessThan(staleAfter);
  });

  it("the initial and periodic reaps are never awaited into the startup path", () => {
    // The other half of the same verified hang: awaiting the reaper before
    // serve() started meant an unreachable database blocked the whole
    // process from coming up, including /health, which touches no database
    // at all.
    const mainStart = SERVER.indexOf("function main()");
    expect(mainStart, "main() not found").toBeGreaterThan(-1);
    const mainBody = SERVER.slice(mainStart, SERVER.indexOf("\nmain();"));
    expect(mainBody).not.toMatch(/await reapStaleJobs/);
    expect(mainBody).toMatch(/reapStaleJobsSafely/);
  });
});

describe("user_id reaches the render service", () => {
  it("mavis-hyperframes forwards it to POST /render", () => {
    // The render service's storage path needs this; mavis-hyperframes
    // already resolves userId for its own hyperframes_renders insert two
    // lines above the outbound fetch — this asserts it also reaches the
    // request body sent onward, not just the local table.
    const idx = HYPERFRAMES.indexOf(`fetch(\`\${RENDER_URL}/render\`,`);
    expect(idx, "the outbound render call was not found").toBeGreaterThan(-1);
    const call = HYPERFRAMES.slice(idx, HYPERFRAMES.indexOf(");", idx));
    expect(call, "user_id is not forwarded to the render service").toMatch(/user_id:\s*userId/);
  });

  it("the render service requires it and validates it strictly", () => {
    // Validated as a UUID because it becomes the first segment of a storage
    // object path — an unvalidated value reaching there is a path-injection
    // surface, not just a data-quality nicety.
    expect(SERVER).toMatch(/UUID_RE\.test\(userId\)/);
    expect(SERVER).toMatch(/user_id is required and must be a UUID/);
  });
});
