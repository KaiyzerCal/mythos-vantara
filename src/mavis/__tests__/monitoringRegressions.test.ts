import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import * as sefirot from "../../../supabase/functions/_shared/sefirot";

// Execute the real helper bodies, without evaluating Deno entrypoint setup.
function helper(path: string, name: string, deps: Record<string, unknown>) {
  const source = readFileSync(resolve(process.cwd(), path), "utf8");
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const fn = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!fn) throw new Error(`Missing helper: ${name}`);
  const js = ts.transpileModule(fn.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(deps), `${js}; return ${name};`)(...Object.values(deps));
}

function database(rows: Record<string, any[]>, allowed?: Record<string, string[]>) {
  const writes: Array<{ id: string; proficiency: number }> = [];
  const logs: string[] = [];
  const sb = { from(table: string) {
    let data = rows[table] ?? [];
    let update: any;
    let error: any = null;
    const q: any = {
      select(cols: string) {
        const missing = allowed?.[table] && cols.split(",").map(c => c.trim()).find(c => !allowed[table].includes(c));
        if (missing) error = new Error(`column ${table}.${missing} does not exist`);
        return q;
      },
      eq(key: string, value: unknown) { data = data.filter(row => row[key] === value); return q; },
      in(key: string, values: unknown[]) { data = data.filter(row => values.includes(row[key])); return q; },
      contains() { data = []; return q; },
      order() { return q; }, limit() { return q; },
      range(from: number, to: number) { data = data.slice(from, to + 1); return q; },
      update(value: any) { update = value; return q; },
      insert(value: any) { logs.push(value.description); return q; },
      maybeSingle() { return Promise.resolve({ data: error ? null : data[0], error }); },
      then(done: (result: any) => unknown) {
        if (update && !error) for (const row of data) {
          Object.assign(row, update);
          writes.push({ id: row.id, proficiency: row.proficiency });
        }
        // Database snapshots must not share mutable references with the plan.
        return Promise.resolve({ data: error ? null : structuredClone(data), error }).then(done);
      },
    };
    return q;
  } };
  return { sb, writes, logs };
}

describe("monitoring regressions", () => {
  it("keeps the full Black Sun gain (40 → 45) and adds the 33% dividend (45 → 47)", async () => {
    const skills = [
      { id: "trunk", name: "Black Sun", is_sovereign_trunk: true, parent_skill_id: null },
      { id: "aux", name: "Auxiliary", parent_skill_id: null },
      { id: "tseq", name: "Trunk sequence", parent_skill_id: "trunk", proficiency: 40 },
      { id: "aseq", name: "Auxiliary sequence", parent_skill_id: "aux", proficiency: 40 },
    ].map(row => ({ tier: 1, unlocked: true, proficiency: 0, category: "Beyonder", user_id: "operator", ...row }));
    const db = database({ skills });
    const bump = helper("supabase/functions/mavis-actions/index.ts", "bumpLinkedSkillProficiency", {
      ...sefirot,
      computeProficiencyGain: helper("supabase/functions/mavis-actions/index.ts", "computeProficiencyGain", {
        DIFFICULTY_MULTIPLIER: { Easy: 1, Normal: 2, Hard: 3, Extreme: 5, Impossible: 8 },
      }),
      logActivity: async (_sb: unknown, _uid: string, _type: string, text: string) => { db.logs.push(text); },
    });
    const result = await bump(db.sb, "operator", ["aseq", "tseq"], 50, "Extreme");
    expect(db.writes.filter(w => w.id === "tseq").map(w => w.proficiency)).toEqual([45, 47]);
    expect(skills.find(s => s.id === "tseq")?.proficiency).toBe(47);
    expect(result.convergence_points).toBe(2);
    expect(db.logs.some(text => text.includes("45% -> 47%"))).toBe(true);
  });

  it("loads Telegram identity, stats, quests and energy using real schema fields", async () => {
    const profile = { id: "operator", inscribed_name: "Calvin", level: 40, rank: "C", current_form: "Base", xp: 25,
      xp_to_next_level: 500, stat_str: 21, stat_agi: 22, stat_int: 23, stat_vit: 24, stat_wis: 25, stat_cha: 26, stat_lck: 27, arc_story: "Arc" };
    const energy = { user_id: "operator", type: "Aura", current_value: 35, max_value: 100, status: "Stable" };
    const db = database({ profiles: [profile], energy_systems: [energy] }, {
      profiles: Object.keys(profile), energy_systems: Object.keys(energy),
    });
    const load = helper("supabase/functions/mavis-telegram-bot/index.ts", "loadAppContext", {
      sb: db.sb, formatBeyonderTree: () => "",
      fetchAllRows: async (_sb: unknown, table: string, cols: string) => {
        if (table !== "quests") return [];
        const quest = { id: "quest", title: "Training", type: "Daily", status: "active", progress_current: 2,
          progress_target: 5, description: "Practice", linked_skill_ids: [] as string[] };
        for (const col of cols.split(",")) if (!(col in quest)) throw new Error(`column quests.${col} does not exist`);
        return [quest];
      },
    });
    const context = await load("operator");
    expect(context).toContain("Calvin — Lv40 C | Form: Base");
    expect(context).toContain("STR:21 AGI:22 INT:23 VIT:24 WIS:25 CHA:26 LCK:27");
    expect(context).toContain('"Training" [Daily] 2/5');
    expect(context).toContain("Aura:35/100[Stable]");
  });
});