// "Name anything, learn it to mastery" — the half of /study that teaches
// material the operator has not written down.
//
// Two things here can break silently. The first is the operator's own material
// quietly falling out of the pipeline, leaving a course that claims to be about
// their vault entry while being about the model's idea of the topic. The second
// is the XP formula drifting between the server that owns it and the client
// that draws the bar for it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { levelGoal } from "@/components/study/LearnMode";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const FN = read("supabase/functions/mavis-study-course/index.ts");
const UI = read("src/components/study/LearnMode.tsx");
const MIGRATION = read("supabase/migrations/20260904120000_study_courses.sql");
/**
 * The migration with its `--` comments stripped.
 *
 * Asserting on the raw file flagged the comment that explains *why* this table
 * avoids auth.users as if it were a reference to it. The same mistake caught a
 * test earlier in this codebase: match on what runs, not on what it says.
 */
const DDL = MIGRATION.replace(/--[^\n]*/g, "");

describe("the operator's own material comes first", () => {
  it("searches everything they have written before generating anything", () => {
    // searchAppData spans the whole app. Losing this call turns a course about
    // their own vault entry into a course about the model's idea of the topic.
    expect(FN).toMatch(/import \{ searchAppData \}/);
    expect(FN).toMatch(/async function ownMaterial/);
    expect(FN).toMatch(/const hits = await ownMaterial\(subject\)/);
  });

  it("degrades to a general course instead of failing when search breaks", () => {
    // Search is an enhancement. An outage in it must not take the feature down.
    const block = /async function ownMaterial[\s\S]*?\n    \}/.exec(FN)?.[0] ?? "";
    expect(block).toMatch(/catch/);
    expect(block).toMatch(/return \[\]/);
  });

  it("records which of the two a course actually was", () => {
    // The operator should never have to guess whether they are reading their
    // own material back or a model's account of the subject.
    expect(FN).toMatch(/grounded_in: grounded \? "own_material" : "general"/);
    expect(MIGRATION).toMatch(/grounded_in\s+text NOT NULL DEFAULT 'general'/);
  });

  it("says so in the UI, both ways round", () => {
    expect(UI).toMatch(/Built from your own material/);
    expect(UI).toMatch(/Built from general knowledge/);
  });

  it("scopes every read and write to the caller", () => {
    const scoped = [...FN.matchAll(/\.eq\("user_id", userId\)/g)];
    expect(scoped.length).toBeGreaterThanOrEqual(4);
    expect(FN).toMatch(/user_id: userId/);
  });
});

describe("the generated shape is repaired before it reaches the UI", () => {
  it("always produces eight tiers, padding rather than failing", () => {
    // A six-tier ladder renders as a broken ascent and breaks tiers[level-1].
    expect(FN).toMatch(/export function coerceTiers/);
    expect(FN).toMatch(/for \(let i = out\.length; i < MAX_LEVEL; i\+\+\)/);
  });

  it("drops questions that cannot be answered as posed", () => {
    expect(FN).toMatch(/options\.length !== 4 \|\| new Set\(options\)\.size !== 4/);
    expect(FN).toMatch(/idx < 0 \|\| idx > 3/);
  });

  it("carries eight distinct registers, one per tier", () => {
    const block = /export const REGISTER = \[([\s\S]*?)\];/.exec(FN)?.[1] ?? "";
    const entries = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(entries).toHaveLength(8);
    expect(new Set(entries).size).toBe(8);
  });
});

describe("scoring stays on the server", () => {
  it("never lets the client report its own XP", () => {
    // The client posts what was answered; the server decides what it is worth.
    // Accepting a client-supplied xp or level would make levelling self-served.
    const answer = /if \(action === "answer"\)[\s\S]*?\n    \}/.exec(FN)?.[0] ?? "";
    expect(answer).toMatch(/xpForAnswer/);
    expect(answer).toMatch(/applyXp/);
    expect(answer).not.toMatch(/body\?\.(xp|level)\b/);
  });

  it("keeps the client's progress-bar goal identical to the server's", () => {
    // Two copies of one formula. If the server's changes and this does not,
    // the bar fills to the wrong place and nothing else complains.
    const serverGoal = /export function levelGoal\(level: number\): number \{\s*return ([^;]+);/.exec(FN)?.[1]?.trim();
    expect(serverGoal).toBe("300 + (level - 1) * 250");
    for (let lvl = 1; lvl <= 8; lvl++) {
      expect(levelGoal(lvl)).toBe(300 + (lvl - 1) * 250);
    }
  });

  it("still pays something for a wrong answer", () => {
    // The attempt is the learning. Zero XP for a miss turns the quiz back into
    // a score, which is the thing this design is trying not to be.
    const fn = /export function xpForAnswer[\s\S]*?\n\}/.exec(FN)?.[0] ?? "";
    expect(fn).toMatch(/correct \? .+ : 8 \+ Math\.round\(level \* 1\.5\)/);
  });
});

describe("the migration follows the four DDL rules", () => {
  it("sets a transaction-local lock_timeout before touching anything", () => {
    expect(MIGRATION).toMatch(/set_config\('lock_timeout', ?'3s', ?true\)/);
    expect(MIGRATION).toMatch(/set_config\('statement_timeout'/);
  });

  it("does not reference auth.users", () => {
    // This is the line that took the auth service down on 2026-08-22. Ownership
    // needs user_id plus RLS; the FK would only buy ON DELETE CASCADE.
    expect(DDL).not.toMatch(/auth\.users/);
    expect(DDL).toMatch(/user_id\s+uuid NOT NULL/);
  });

  it("is re-runnable after a lock timeout", () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS/);
    expect(MIGRATION).toMatch(/CREATE INDEX IF NOT EXISTS/);
    expect(MIGRATION).toMatch(/EXCEPTION WHEN duplicate_object THEN NULL/);
  });

  it("enables RLS and scopes both directions", () => {
    // USING alone guards reads; without WITH CHECK an operator could insert a
    // row owned by someone else.
    expect(MIGRATION).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(MIGRATION).toMatch(/USING \(auth\.uid\(\) = user_id\)/);
    expect(MIGRATION).toMatch(/WITH CHECK \(auth\.uid\(\) = user_id\)/);
  });
});
