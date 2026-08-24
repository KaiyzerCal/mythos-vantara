// Schema drift guard for the video pipeline.
//
// The producer and the asset worker are Deno edge functions: there is no Deno
// toolchain in this environment and no live project to integration-test
// against, so nothing type-checks the column names they use. A typo or a
// column that never made it into the migration fails at runtime, inside a cron
// tick, where the only symptom is a production quietly stuck in "generating".
//
// This reads the migration and both functions and asserts they agree on the
// columns and the status vocabulary — the same static-verification approach as
// actionBackendFieldSync.test.ts.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const MIGRATION = read("supabase/migrations/20260822120000_video_productions.sql");
const PRODUCER = read("supabase/functions/mavis-video-producer/index.ts");
const WORKER = read("supabase/functions/mavis-video-asset-worker/index.ts");
const ASSETS = read("supabase/functions/_shared/videoAssets.ts");

/** Column names declared for one CREATE TABLE block in the migration. */
function columnsOf(table: string): string[] {
  const start = MIGRATION.indexOf(`CREATE TABLE IF NOT EXISTS public.${table}`);
  expect(start, `${table} not found in the migration`).toBeGreaterThan(-1);
  const body = MIGRATION.slice(start, MIGRATION.indexOf("\n);", start));
  return [...body.matchAll(/^\s{2}([a-z_]+)\s+[a-z]/gm)].map((m) => m[1]);
}

/** Values of a CHECK (col IN (...)) constraint. */
function checkValues(column: string): string[] {
  const re = new RegExp(`${column}\\s+text[^)]*?CHECK \\(${column} IN \\(([^)]+)\\)`, "s");
  const m = MIGRATION.match(re);
  expect(m, `no CHECK ... IN constraint found for ${column}`).not.toBeNull();
  return [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

/** Columns named inside a .select("…") on a given table in a source file. */
function selectedColumns(src: string, table: string): string[] {
  const cols = new Set<string>();
  const re = new RegExp(`from\\("${table}"\\)[\\s\\S]{0,200}?\\.select\\(\\s*\\n?\\s*"([^"]+)"`, "g");
  for (const m of src.matchAll(re)) {
    if (m[1].trim() === "*") continue;
    for (const c of m[1].split(",")) {
      const name = c.trim();
      if (name && /^[a-z_]+$/.test(name)) cols.add(name);
    }
  }
  return [...cols];
}

describe("mavis_video_productions columns", () => {
  const declared = columnsOf("mavis_video_productions");

  it("declares the columns Phase 1 and Phase 2 both rely on", () => {
    for (const col of [
      "id", "user_id", "brief", "title", "production_type", "format", "visual_mode",
      "target_seconds", "persona_id", "avatar_name", "voice_id", "status",
      "render_id", "output_url", "warnings", "error_message",
      "generation_budget", "generations_used",
    ]) {
      expect(declared, `migration is missing ${col}`).toContain(col);
    }
  });

  it.each([["producer", PRODUCER], ["worker", WORKER]])(
    "every column the %s selects exists",
    (_label, src) => {
      for (const col of selectedColumns(src, "mavis_video_productions")) {
        expect(declared, `selects "${col}" which the migration does not declare`).toContain(col);
      }
    },
  );
});

describe("mavis_video_beats columns", () => {
  const declared = columnsOf("mavis_video_beats");

  it("declares everything a beat carries, including provider job tracking", () => {
    for (const col of [
      "id", "production_id", "user_id", "idx", "narration", "visual_prompt",
      "on_screen_text", "seconds", "asset_url", "audio_url",
      "provider", "provider_job_id", "status", "error_message", "attempts",
    ]) {
      expect(declared, `migration is missing ${col}`).toContain(col);
    }
  });

  it.each([["producer", PRODUCER], ["worker", WORKER]])(
    "every column the %s selects exists",
    (_label, src) => {
      for (const col of selectedColumns(src, "mavis_video_beats")) {
        expect(declared, `selects "${col}" which the migration does not declare`).toContain(col);
      }
    },
  );

  it("the worker's BeatRow type matches the beat columns it reads", () => {
    const start = ASSETS.indexOf("export interface BeatRow");
    const fields = [...ASSETS.slice(start, ASSETS.indexOf("}", start))
      .matchAll(/^\s{2}([a-z_]+)[?:]/gm)].map((m) => m[1]);
    expect(fields.length).toBeGreaterThan(5);
    for (const f of fields) {
      expect(declared, `BeatRow declares "${f}", absent from the migration`).toContain(f);
    }
  });
});

describe("status vocabularies agree", () => {
  it("every production status the code sets is allowed by the CHECK constraint", () => {
    const allowed = checkValues("status");
    // The productions CHECK is the first one in the file; confirm we grabbed it.
    expect(allowed).toContain("storyboarded");

    const set = new Set<string>();
    for (const src of [PRODUCER, WORKER, ASSETS]) {
      for (const m of src.matchAll(/status:\s*"([a-z_]+)"/g)) set.add(m[1]);
      for (const m of src.matchAll(/status:\s*ProductionStatus[^=]*=\s*"([a-z_]+)"/g)) set.add(m[1]);
    }
    // Beat statuses live in the same literal form; both vocabularies are
    // checked together against the union the migration permits.
    const beatAllowed = ["pending", "generating", "ready", "failed", "skipped"];
    for (const s of set) {
      expect(
        [...allowed, ...beatAllowed],
        `code sets status "${s}", which neither CHECK constraint permits`,
      ).toContain(s);
    }
  });

  it("the ProductionStatus union does not promise states the table rejects", () => {
    const allowed = checkValues("status");
    const start = ASSETS.indexOf("export type ProductionStatus");
    const union = ASSETS.slice(start, ASSETS.indexOf(";", start));
    for (const m of union.matchAll(/"([a-z_]+)"/g)) {
      expect(allowed, `ProductionStatus includes "${m[1]}", which the table rejects`).toContain(m[1]);
    }
  });

  it("production_type and visual_mode agree between planner and table", () => {
    expect(checkValues("production_type").sort()).toEqual(["avatar", "faceless", "persona_ugc"]);
    expect(checkValues("visual_mode").sort()).toEqual(["stills", "video"]);
  });
});

describe("the worker is not publicly callable", () => {
  it("requires the service key, since every tick can spend money", () => {
    expect(WORKER).toMatch(/token !== SERVICE_KEY/);
  });

  it("has a cron schedule wired to it", () => {
    const cron = read("supabase/migrations/20260822130000_video_asset_worker_cron.sql");
    expect(cron).toContain("mavis-video-asset-worker");
    expect(cron).toMatch(/cron\.schedule/);
  });
});
