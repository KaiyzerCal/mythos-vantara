// Guards on the dual-avatar identity system.
//
// Three things can break here, and none of them throws at runtime:
//
//   1. The client mirror in src/lib/avatarIdentity.ts drifts from the Deno
//      module the pipeline actually reads, so the UI promises one look and the
//      renderer produces another.
//   2. A style value stops matching the CHECK constraint in the migration, so
//      writes fail in production and nowhere else.
//   3. The producer or worker stops threading the profile through, so the
//      identity is selected, stored, displayed — and ignored.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IDENTITIES, identityByKey, OVERLAY_LABELS, RENDERING_LABELS,
  RENDERING_STYLES, OVERLAY_STYLES,
} from "@/lib/avatarIdentity";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const SHARED = read("supabase/functions/_shared/avatarProfile.ts");
const MIGRATION = read("supabase/migrations/20260827120000_avatar_identity_config.sql");
const PRODUCER = read("supabase/functions/mavis-video-producer/index.ts");
const WORKER = read("supabase/functions/mavis-video-asset-worker/index.ts");
const DISPATCH = read("supabase/functions/mavis-chat/toolDispatch.ts");

/** Read one preset's literal fields out of the Deno module. */
function presetFields(constName: string): Record<string, string> {
  const start = SHARED.indexOf(`export const ${constName}: AvatarProfile = {`);
  expect(start, `${constName} not found in avatarProfile.ts`).toBeGreaterThan(-1);
  const body = SHARED.slice(start, SHARED.indexOf("\n};", start));
  const out: Record<string, string> = {};
  for (const f of ["key", "name", "rendering_style", "overlay_style"]) {
    const m = body.match(new RegExp(`\\n {2}${f}:\\s*"([^"]+)"`));
    if (m) out[f] = m[1];
  }
  const tags = body.match(/\n {2}domain_tags: \[([^\]]*)\]/);
  out.domain_tags = tags ? [...tags[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).join(",") : "";
  return out;
}

describe("the client mirror matches the pipeline's module", () => {
  const pairs = [["SKYFORGE", "avatar_skyforge_real"], ["BIONEER", "avatar_bioneer_animated"]] as const;

  it("ships exactly the two presets, in both places", () => {
    expect(IDENTITIES.map((i) => i.key).sort())
      .toEqual(["avatar_bioneer_animated", "avatar_skyforge_real"]);
    for (const [constName] of pairs) {
      expect(SHARED, `${constName} missing`).toContain(`export const ${constName}: AvatarProfile`);
    }
  });

  it.each(pairs)("%s agrees on key, name, rendering and overlay style", (constName, key) => {
    const shared = presetFields(constName);
    const client = identityByKey(key);
    expect(client, `${key} missing from the client mirror`).not.toBeNull();
    expect(client!.key).toBe(shared.key);
    expect(client!.name).toBe(shared.name);
    expect(client!.rendering_style).toBe(shared.rendering_style);
    expect(client!.overlay_style).toBe(shared.overlay_style);
  });

  it.each(pairs)("%s agrees on domain tags", (constName, key) => {
    // Routing reads these. A tag present on one side only means the brief
    // routes to an identity the UI never offers, or vice versa.
    expect(identityByKey(key)!.domain_tags.join(",")).toBe(presetFields(constName).domain_tags);
  });

  it("pairs the two identities to opposite rendering styles", () => {
    // The whole point of the feature: one photoreal, one animated. If both
    // ended up the same, everything below would still pass.
    expect(new Set(IDENTITIES.map((i) => i.rendering_style)).size).toBe(2);
    expect(new Set(IDENTITIES.map((i) => i.overlay_style)).size).toBe(2);
  });
});

describe("the vocabularies agree with the database", () => {
  it("every rendering style is allowed by the CHECK constraint", () => {
    const m = MIGRATION.match(/rendering_style IN \(([^)]+)\)/);
    expect(m, "no rendering_style CHECK in the migration").not.toBeNull();
    const allowed = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(allowed.sort()).toEqual([...RENDERING_STYLES].sort());
  });

  it("every overlay style is allowed by the CHECK constraint", () => {
    const m = MIGRATION.match(/overlay_style IN \(([^)]+)\)/);
    expect(m, "no overlay_style CHECK in the migration").not.toBeNull();
    const allowed = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(allowed.sort()).toEqual([...OVERLAY_STYLES].sort());
  });

  it("the Deno module and the client agree on both vocabularies", () => {
    for (const v of RENDERING_STYLES) expect(SHARED).toContain(`"${v}"`);
    for (const v of OVERLAY_STYLES) expect(SHARED).toContain(`"${v}"`);
  });

  it("labels every value the UI can select", () => {
    // A missing label renders as blank in the dropdown rather than throwing.
    for (const o of OVERLAY_STYLES) expect(OVERLAY_LABELS[o], o).toBeTruthy();
    for (const r of RENDERING_STYLES) expect(RENDERING_LABELS[r], r).toBeTruthy();
  });
});

describe("the migration is safe and re-runnable", () => {
  it("sets lock_timeout inside the block, not only as a session SET", () => {
    expect(MIGRATION).toMatch(/set_config\('lock_timeout'[^)]*true\)/);
  });

  it("adds every column idempotently", () => {
    const adds = [...MIGRATION.matchAll(/ADD COLUMN (IF NOT EXISTS )?/g)];
    expect(adds.length).toBeGreaterThan(0);
    for (const a of adds) expect(a[1], "an ADD COLUMN is missing IF NOT EXISTS").toBeTruthy();
  });

  it("guards the CHECK constraints by name", () => {
    // ADD COLUMN IF NOT EXISTS is a no-op on a re-run, which would skip an
    // inline CHECK and leave the column unconstrained with no error.
    for (const c of ["personas_rendering_style_check", "personas_overlay_style_check"]) {
      expect(MIGRATION).toContain(c);
    }
    expect(MIGRATION).toMatch(/pg_constraint/);
  });

  it("carries the identity on the production row", () => {
    // persona_id is not enough: a preset can drive a production before it has
    // been forged into a personas row, and then only the key exists.
    expect(MIGRATION).toMatch(/mavis_video_productions[\s\S]{0,120}avatar_key/);
  });
});

describe("the pipeline actually uses the identity", () => {
  it("the producer feeds it to the director prompt", () => {
    expect(PRODUCER).toMatch(/identityPromptWrapper/);
    expect(PRODUCER).toMatch(/storyboardSystemPrompt\([^)]*profile\)/);
  });

  it("the producer resolves an identity for every production type", () => {
    // Scoping this to persona_ugc would leave a faceless SkyForge short looking
    // identical to a faceless Bioneer one.
    const scoped = /if \(productionType === "persona_ugc"\)[\s\S]{0,200}presetByKey/;
    expect(PRODUCER).toMatch(/presetByKey/);
    expect(PRODUCER, "identity resolution is gated on persona_ugc").not.toMatch(scoped);
  });

  it("the producer persists the identity on the production", () => {
    expect(PRODUCER).toMatch(/avatar_key: profile\?\.key/);
  });

  it("the worker loads the identity and styles every visual with it", () => {
    expect(WORKER).toMatch(/loadProfile/);
    // Both generation paths, or the two modes disagree about the look.
    const styled = [...WORKER.matchAll(/styleVisualPrompt\(/g)];
    expect(styled.length, "expected both the stills and video paths to be styled")
      .toBeGreaterThanOrEqual(2);
  });

  it("the worker loads the identity once per tick, not once per beat", () => {
    expect(WORKER).toMatch(/const profile = await loadProfile\(production\);/);
    expect(WORKER).toMatch(/processBeat\(beat, production, profile\)/);
  });

  it("the worker falls back to the identity's voice", () => {
    expect(WORKER).toMatch(/production\.voice_id \?\? profile\?\.voice_id/);
  });

  it("MAVIS can select an identity from chat", () => {
    expect(DISPATCH).toMatch(/avatar_key/);
    expect(DISPATCH).toMatch(/avatar_skyforge_real/);
    expect(DISPATCH).toMatch(/avatar_bioneer_animated/);
  });
});
