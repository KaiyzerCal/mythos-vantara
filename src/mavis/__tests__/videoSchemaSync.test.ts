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
  // Terminator and indent both have to be indent-agnostic. The CREATE TABLE
  // statements moved inside a DO block when the auth.users foreign keys were
  // split out of them (see the migration header), which shifted every column
  // by two spaces and moved the closing paren off column 0. Matching a fixed
  // indent silently returned zero columns, so every "is this column declared"
  // assertion failed at once rather than reporting real drift.
  const end = MIGRATION.slice(start).search(/^\s*\);/m);
  const body = MIGRATION.slice(start, end === -1 ? undefined : start + end);
  return [...body.matchAll(/^\s+([a-z_]+)\s+(?:uuid|text|integer|numeric|jsonb|timestamptz|boolean)\b/gm)]
    .map((m) => m[1]);
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

describe("the render stage", () => {
  const COMPOSITION = read("supabase/functions/_shared/composition.ts");
  const HYPERFRAMES = read("supabase/functions/mavis-hyperframes/index.ts");

  it("sends mavis-hyperframes exactly the fields its render action reads", () => {
    // The proxy destructures composition_html, assets, width, height, fps.
    for (const field of ["composition_html", "assets", "width", "height", "fps"]) {
      expect(WORKER, `render submission omits ${field}`).toMatch(new RegExp(`${field}:`));
    }
    expect(WORKER).toMatch(/action: "render"/);
    expect(WORKER).toMatch(/action: "status"/);
  });

  it("honours the asset cap the proxy actually enforces", () => {
    // mavis-hyperframes slices assets to 20; the composer must agree, or a
    // long production silently loses preload hints with no explanation.
    const proxyCap = HYPERFRAMES.match(/assets\)\s*\?\s*body\.assets\.slice\(0,\s*(\d+)\)/);
    expect(proxyCap, "could not find the proxy's asset cap").not.toBeNull();
    const declared = COMPOSITION.match(/MAX_DECLARED_ASSETS = (\d+)/);
    expect(declared).not.toBeNull();
    expect(Number(declared![1])).toBe(Number(proxyCap![1]));
  });

  it("reacts to every status the proxy can return", () => {
    // mavis-hyperframes returns queued | rendering | ready | failed.
    for (const status of ["ready", "failed"]) {
      expect(WORKER, `worker never handles a "${status}" render`).toContain(`"${status}"`);
    }
  });

  it("stores the finished film in columns vault_media actually has", () => {
    const vaultMigration = read("supabase/migrations/20260517220000_mavis_advanced.sql");
    const start = vaultMigration.indexOf("CREATE TABLE IF NOT EXISTS public.vault_media");
    const body = vaultMigration.slice(start, vaultMigration.indexOf("\n);", start));
    const declared = [...body.matchAll(/^\s{2}([a-z_]+)\s+[a-z]/gm)].map((m) => m[1]);

    const insertStart = WORKER.indexOf('from("vault_media").insert(');
    expect(insertStart, "the finished video is never saved to the gallery").toBeGreaterThan(-1);
    const insert = WORKER.slice(insertStart, WORKER.indexOf("});", insertStart));
    for (const m of insert.matchAll(/^\s+([a-z_]+):/gm)) {
      expect(declared, `writes vault_media.${m[1]}, which does not exist`).toContain(m[1]);
    }
  });

  it("gives the finished film a real MIME type, so the gallery shows it", () => {
    // The gallery's classifier reads the leading MIME token; a bare "video"
    // was the bug that hid MAVIS-generated images earlier on this branch.
    const insertStart = WORKER.indexOf('from("vault_media").insert(');
    const insert = WORKER.slice(insertStart, WORKER.indexOf("});", insertStart));
    expect(insert).toMatch(/file_type:\s*"video\/mp4"/);
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
