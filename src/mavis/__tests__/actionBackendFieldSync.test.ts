// Static drift-detection for the 4 update-path schemas covered by
// vantara-crud-update-fix-brief.md. mavis-actions/index.ts is a Deno edge
// function — there's no Deno test harness or live Supabase project in this
// environment to run true insert/update/persist integration tests against
// (same access constraint as the rest of the Execution Blueprint work this
// session). What IS verifiable without live infra: that actionSchemas.ts's
// declared update fields for these 4 types stay in sync with
// mavis-actions/index.ts's actual per-field update allowlist
// (`for (const key of [...]) { if (p[key] !== undefined) updates[key] = ... }`).
// If someone edits one side without the other, this test catches it —
// exactly the class of bug this whole brief exists to close.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const BACKEND_SRC = readFileSync(join(ROOT, "supabase/functions/mavis-actions/index.ts"), "utf8");
const FRONTEND_EXECUTOR_SRC = readFileSync(join(ROOT, "src/mavis/actionExecutor.ts"), "utf8");

// Extracts the `for (const key of [...]) { if (p[key] !== undefined) updates[key]`
// allowlist immediately following a given `case "...": {` handler.
function extractUpdateAllowlist(caseLabel: string): string[] {
  const caseIdx = BACKEND_SRC.indexOf(`case "${caseLabel}":`);
  expect(caseIdx, `case "${caseLabel}" not found in mavis-actions/index.ts`).toBeGreaterThan(-1);
  const slice = BACKEND_SRC.slice(caseIdx, caseIdx + 1500);
  const match = slice.match(/for \(const key of \[([^\]]+)\]\)/);
  expect(match, `no "for (const key of [...])" allowlist found near case "${caseLabel}"`).not.toBeNull();
  return match![1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

// What actionSchemas.ts's UpdateXSchema declares as update fields (excludes
// the "type" discriminant and lookup-only fields like skill_id/entry_id/
// item_id/skill_name/entry_title/item_name/id, which resolveId() consumes
// separately, not via the updates[key] allowlist loop).
const DECLARED_UPDATE_FIELDS = {
  update_skill: ["name", "description", "category", "energy_type", "tier", "unlocked", "proficiency"],
  update_journal: ["title", "content", "tags", "category", "importance", "mood"],
  update_vault: ["title", "content", "category", "importance"],
  // "type" deliberately excluded — see the comment above UpdateInventorySchema
  // in actionSchemas.ts for why it can't be represented in this action shape.
  update_inventory_item: ["name", "description", "rarity", "quantity", "effect", "slot", "tier", "is_equipped", "stat_effects"],
  // "type" deliberately excluded — see UpdateQuestSchema's quest_type comment.
  update_quest: ["title", "description", "status", "difficulty", "xp_reward", "progress_current", "progress_target", "real_world_mapping", "category"],
  // "type" deliberately excluded — see UpdateEnergySchema's energy_type comment.
  update_energy: ["current_value", "max_value", "status", "description", "color"],
} as const;

// Several update handlers' backend allowlists include "type" (the row's own
// type column), which can't appear in the corresponding UpdateXSchema — the
// Zod discriminant for every action schema is itself named "type". Each of
// these has a renamed fallback field (quest_type/item_type/energy_type) that
// the handler reads instead — a documented, intentional, structural gap (see
// each schema's own comment in actionSchemas.ts), not drift — excluded from
// the comparison here on that basis, not swept under the rug.
const KNOWN_UNREPRESENTABLE: Record<string, string[]> = {
  update_inventory_item: ["type"],
  update_quest: ["type"],
  update_energy: ["type"],
};

describe("update schema fields stay in sync with mavis-actions' real allowlists", () => {
  for (const [caseLabel, declared] of Object.entries(DECLARED_UPDATE_FIELDS)) {
    it(`${caseLabel}: actionSchemas.ts fields match mavis-actions/index.ts's update allowlist exactly`, () => {
      const backendFields = extractUpdateAllowlist(caseLabel)
        .filter((f) => !(KNOWN_UNREPRESENTABLE[caseLabel] ?? []).includes(f));
      const declaredSet = [...declared].sort();
      const backendSet = [...backendFields].sort();
      expect(declaredSet).toEqual(backendSet);
    });
  }
});

// actionExecutor.ts normalizes alias action-type spellings (e.g. "remove_quest")
// to their canonical form BEFORE Zod validation and the ALWAYS_CONFIRM gate — see
// the ACTION_ALIASES comment at the top of that file. If its alias map drifts
// out of sync with mavis-actions/index.ts's own ACTION_ALIASES (the backend adds
// one here without the frontend picking it up), any action using that alias
// silently skips both validation and the confirm-before-execute gate for
// destructive actions. This was previously an unenforced claim in a comment;
// this test makes it real.
function extractAliasMap(src: string): Record<string, string> {
  const start = src.indexOf("const ACTION_ALIASES");
  expect(start, "ACTION_ALIASES not found").toBeGreaterThan(-1);
  const braceStart = src.indexOf("{", start);
  let depth = 0, end = -1;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = src.slice(braceStart + 1, end);
  const pairs: Record<string, string> = {};
  const re = /"([^"]+)"\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) pairs[m[1]] = m[2];
  return pairs;
}

describe("actionExecutor's ACTION_ALIASES stays in sync with mavis-actions'", () => {
  it("every backend alias exists in the frontend with the same canonical target", () => {
    const backendAliases = extractAliasMap(BACKEND_SRC);
    const frontendAliases = extractAliasMap(FRONTEND_EXECUTOR_SRC);
    const missing: string[] = [];
    const mismatched: string[] = [];
    for (const [alias, canonical] of Object.entries(backendAliases)) {
      if (!(alias in frontendAliases)) missing.push(alias);
      else if (frontendAliases[alias] !== canonical) mismatched.push(alias);
    }
    expect(missing, `aliases in mavis-actions/index.ts missing from actionExecutor.ts: ${missing.join(", ")}`).toEqual([]);
    expect(mismatched, `aliases mapping to a different canonical type: ${mismatched.join(", ")}`).toEqual([]);
  });
});
