import { describe, it, expect } from "vitest";
import { ActionSchema } from "../actionSchemas";

describe("ActionSchema discriminated union", () => {
  it("validates a create_quest action", () => {
    const result = ActionSchema.safeParse({ type: "create_quest", title: "My Quest" });
    expect(result.success).toBe(true);
  });

  it("rejects create_quest without a title", () => {
    const result = ActionSchema.safeParse({ type: "create_quest", title: "" });
    expect(result.success).toBe(false);
  });

  it("validates a create_task action with optional fields", () => {
    // priority/due_date are not real create_task fields (never were — see
    // CreateTaskSchema's own comment); a non-strict object still accepts
    // the payload and just strips them, so this stays a valid parse.
    const result = ActionSchema.safeParse({
      type: "create_task",
      title: "Write docs",
      priority: "high",
      due_date: "2026-06-01",
    });
    expect(result.success).toBe(true);
  });

  it("rejects create_task with invalid difficulty", () => {
    // Replaces a stale test asserting an invalid "priority" was rejected —
    // priority was never a real field, so nothing ever actually rejected
    // it. difficulty is the real enum-constrained field the handler reads.
    const result = ActionSchema.safeParse({ type: "create_task", title: "Task", difficulty: "extreme" });
    expect(result.success).toBe(false);
  });

  it("validates award_xp", () => {
    const result = ActionSchema.safeParse({ type: "award_xp", amount: 100 });
    expect(result.success).toBe(true);
  });

  it("rejects award_xp with zero amount", () => {
    const result = ActionSchema.safeParse({ type: "award_xp", amount: 0 });
    expect(result.success).toBe(false);
  });

  it("validates update_profile with display_name", () => {
    const result = ActionSchema.safeParse({ type: "update_profile", display_name: "Vantara" });
    expect(result.success).toBe(true);
  });

  it("validates log_bpm within range", () => {
    const result = ActionSchema.safeParse({ type: "log_bpm", bpm: 72 });
    expect(result.success).toBe(true);
  });

  it("rejects log_bpm out of range", () => {
    const tooLow = ActionSchema.safeParse({ type: "log_bpm", bpm: 10 });
    const tooHigh = ActionSchema.safeParse({ type: "log_bpm", bpm: 400 });
    expect(tooLow.success).toBe(false);
    expect(tooHigh.success).toBe(false);
  });

  it("validates create_ranking and rejects transformation fields", () => {
    // title/phase were never real create_ranking fields (real fields are
    // display_name and rank — see CreateRankingSchema's own comment).
    const valid = ActionSchema.safeParse({ type: "create_ranking", display_name: "Elite" });
    expect(valid.success).toBe(true);

    // Ranking must not accept transformation-only fields (phase is
    // explicitly typed z.undefined() on this schema to enforce that)
    const contaminated = ActionSchema.safeParse({ type: "create_ranking", display_name: "Elite", phase: "Ascension" });
    expect(contaminated.success).toBe(false);
  });

  it("validates create_transformation and rejects ranking fields", () => {
    // title was never a real create_transformation field (real field is
    // "name" — see CreateTransformationSchema's own comment).
    const valid = ActionSchema.safeParse({ type: "create_transformation", name: "Shadow Form" });
    expect(valid.success).toBe(true);

    // Transformation must not accept ranking-only fields (rank is
    // explicitly typed z.undefined() on this schema to enforce that)
    const contaminated = ActionSchema.safeParse({ type: "create_transformation", name: "Shadow Form", rank: "S" });
    expect(contaminated.success).toBe(false);
  });

  it("validates create_skill with real fields (name/tier/proficiency, not title/level)", () => {
    // title/level were never real create_skill fields — see CreateSkillSchema's
    // own comment in actionSchemas.ts. This replaces a test that was
    // asserting the old, wrong shape validated successfully.
    const valid = ActionSchema.safeParse({ type: "create_skill", name: "Focus", tier: 2, proficiency: 50 });
    expect(valid.success).toBe(true);

    const overMaxProficiency = ActionSchema.safeParse({ type: "create_skill", name: "Focus", proficiency: 101 });
    expect(overMaxProficiency.success).toBe(false);
  });

  it("rejects create_skill without a name", () => {
    expect(ActionSchema.safeParse({ type: "create_skill", description: "no name given" }).success).toBe(false);
  });

  it("validates create_ally with affinity bounds", () => {
    // trust_level is not a real allies column (fabricated — see
    // CreateAllySchema's own comment); the real 0-100 bounded field is
    // "affinity". A stray trust_level key doesn't fail validation, it's
    // just silently stripped, which is why the old bounds test here never
    // actually caught anything.
    const valid = ActionSchema.safeParse({ type: "create_ally", name: "Cipher", affinity: 70 });
    expect(valid.success).toBe(true);

    const overMax = ActionSchema.safeParse({ type: "create_ally", name: "Cipher", affinity: 101 });
    expect(overMax.success).toBe(false);
  });

  it("rejects unknown action type", () => {
    const result = ActionSchema.safeParse({ type: "explode_everything" });
    expect(result.success).toBe(false);
  });
});

// CRUD update-path accuracy fix (vantara-crud-update-fix-brief.md) — these
// are the regression tests that would have caught the original drift
// between what promptBuilder.ts documents, what actionSchemas.ts validates,
// and what mavis-actions/index.ts's handlers + the real table columns
// actually accept. Positive cases are copy-pasted from the exact
// :::ACTION{...}::: examples in promptBuilder.ts, not paraphrased — the bug
// this closes was specifically "the documented example doesn't pass its own
// validator."
describe("create_skill — matches promptBuilder.ts example + real skills columns", () => {
  it("accepts the exact promptBuilder.ts example shape", () => {
    const result = ActionSchema.safeParse({
      type: "create_skill",
      name: "Fireball",
      description: "...",
      category: "Combat",
      energy_type: "Emerald Flames",
      tier: 1,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a sub-skill with parent_skill_name linking", () => {
    const result = ActionSchema.safeParse({
      type: "create_skill",
      name: "Fireball II",
      parent_skill_name: "Fireball",
      tier: 2,
    });
    expect(result.success).toBe(true);
  });

  it("rejects create_skill without a name", () => {
    expect(ActionSchema.safeParse({ type: "create_skill", description: "no name" }).success).toBe(false);
  });

  it("title and level are not real fields — regression guard", () => {
    // {title, level} used to be the ENTIRE schema (both required-ish and
    // both unused by the real handler). name is required now, so a
    // title/level-only payload correctly fails outright.
    const result = ActionSchema.safeParse({ type: "create_skill", title: "Old Shape", level: 50 });
    expect(result.success).toBe(false);
  });
});

describe("create_vault — matches promptBuilder.ts example, confidential removed", () => {
  it("accepts the exact promptBuilder.ts example shape", () => {
    const result = ActionSchema.safeParse({
      type: "create_vault",
      title: "Contract",
      content: "...",
      category: "legal",
      importance: "critical",
    });
    expect(result.success).toBe(true);
  });

  it("confidential is accepted-but-ignored, not rejected (same treatment as update_vault)", () => {
    const result = ActionSchema.safeParse({ type: "create_vault", title: "x", content: "y", confidential: true });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "create_vault") {
      expect("confidential" in result.data).toBe(false);
    }
  });

  it("rejects create_vault without content", () => {
    expect(ActionSchema.safeParse({ type: "create_vault", title: "x" }).success).toBe(false);
  });
});

describe("update_skill — matches promptBuilder.ts example + real skills columns", () => {
  it("accepts the exact promptBuilder.ts example shape", () => {
    const result = ActionSchema.safeParse({
      type: "update_skill",
      skill_id: "abc-123",
      proficiency: 50,
      tier: 1,
      unlocked: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts skill_name-based lookup with a rename", () => {
    const result = ActionSchema.safeParse({
      type: "update_skill",
      skill_name: "Old Name",
      name: "New Name",
      category: "Combat",
    });
    expect(result.success).toBe(true);
  });

  it("level and title are not real fields — a regression back to validating them would need a conscious schema change", () => {
    // {id, level, title} still PARSES under the new schema too — id alone
    // satisfies the lookup refinement, and non-strict z.object() tolerates
    // unrecognized extra keys rather than rejecting them, so a "rejects the
    // old shape" test would be misleading (it was never really rejected by
    // Zod for having those keys; it failed because it lacked entry-style
    // lookup fields the LLM never actually sends this way). The real
    // regression guard: confirm level/title are NOT part of this schema's
    // validated output — if someone reintroduces `level` thinking it's a
    // real skills column, this assertion breaks and forces them to look at
    // why, rather than the mistake silently reappearing.
    const result = ActionSchema.safeParse({ type: "update_skill", id: "abc-123", level: 5, title: "Fireball" });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "update_skill") {
      expect("level" in result.data).toBe(false);
      expect("title" in result.data).toBe(false);
    }
  });

  it("rejects update_skill with no lookup field at all", () => {
    const result = ActionSchema.safeParse({ type: "update_skill", proficiency: 50 });
    expect(result.success).toBe(false);
  });
});

describe("update_journal — matches promptBuilder.ts example + real journal_entries columns", () => {
  it("accepts the exact promptBuilder.ts example shape", () => {
    const result = ActionSchema.safeParse({
      type: "update_journal",
      entry_id: "abc-123",
      title: "Breakthrough",
      content: "...",
      tags: ["tag1"],
      category: "personal",
      importance: "high",
      mood: "relieved",
    });
    expect(result.success).toBe(true);
  });

  it("accepts entry_title-based lookup (no entry_id)", () => {
    const result = ActionSchema.safeParse({ type: "update_journal", entry_title: "Yesterday", mood: "relieved" });
    expect(result.success).toBe(true);
  });

  it("rejects update_journal with no lookup field at all", () => {
    const result = ActionSchema.safeParse({ type: "update_journal", mood: "relieved" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-array tags field", () => {
    const result = ActionSchema.safeParse({ type: "update_journal", entry_id: "x", tags: "not-an-array" });
    expect(result.success).toBe(false);
  });
});

describe("update_vault — matches promptBuilder.ts example, confidential removed", () => {
  it("accepts the exact promptBuilder.ts example shape", () => {
    const result = ActionSchema.safeParse({
      type: "update_vault",
      entry_id: "abc-123",
      title: "Contract",
      content: "...",
      category: "legal",
      importance: "critical",
    });
    expect(result.success).toBe(true);
  });

  it("rejects update_vault with no lookup field at all — this is the real gate-bypass bug", () => {
    // The old schema required a plain "id" field, but promptBuilder.ts has
    // only ever told the LLM to send "entry_id". Every real update_vault
    // action therefore failed ActionSchema.safeParse and silently fell
    // through actionExecutor.ts's legacy path — which calls defaultHandler
    // directly, WITHOUT ever consulting classifyAction(). Since update_vault
    // is CONFIRM-gated by rule, this meant real vault edits were
    // auto-executing with no confirmation, the entire time. This test
    // guards the Zod shape; the CONFIRM-gate regression test lives in
    // highConsequenceActions.test.ts.
    const result = ActionSchema.safeParse({ type: "update_vault", content: "Revised" });
    expect(result.success).toBe(false);
  });

  it("confidential is accepted-but-ignored, not rejected (non-strict object, matches backend which also just ignores it)", () => {
    // Explicitly NOT asserting rejection here: confidential was removed
    // from the schema definition, but z.object() is non-strict by default,
    // so a stray confidential key doesn't fail validation — it's simply
    // never read by anything downstream (same as before, minus the false
    // impression that it did something).
    const result = ActionSchema.safeParse({ type: "update_vault", entry_id: "x", confidential: true });
    expect(result.success).toBe(true);
  });
});

describe("update_inventory_item — matches promptBuilder.ts example + real inventory columns", () => {
  it("accepts the exact promptBuilder.ts example shape", () => {
    const result = ActionSchema.safeParse({
      type: "update_inventory_item",
      item_id: "abc-123",
      name: "Health Potion",
      quantity: 3,
      is_equipped: true,
      effect: "Restores 50 HP",
      stat_effects: [{ label: "AGI", value: 10, unit: "" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts item_name-based lookup", () => {
    const result = ActionSchema.safeParse({ type: "update_inventory_item", item_name: "Health Potion", quantity: 3 });
    expect(result.success).toBe(true);
  });

  it("rejects update_inventory_item with no lookup field at all", () => {
    const result = ActionSchema.safeParse({ type: "update_inventory_item", quantity: 3 });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed stat_effects entry (missing label)", () => {
    const result = ActionSchema.safeParse({
      type: "update_inventory_item",
      item_id: "x",
      stat_effects: [{ value: 10 }],
    });
    expect(result.success).toBe(false);
  });
});

// generate_video/video_status's provider enum was missing kling/runway/
// modelslab/promptchan — all four were already live in mavis-video-gen's
// own provider chain, just unreachable through this validated path.
describe("generate_video / video_status — provider enum matches mavis-video-gen's real chain", () => {
  it.each(["fal", "veo", "omni", "kling", "runway", "modelslab", "promptchan", "auto"])(
    "generate_video accepts provider %s",
    (provider) => {
      expect(ActionSchema.safeParse({ type: "generate_video", prompt: "x", provider }).success).toBe(true);
    },
  );

  it.each(["fal", "veo", "omni", "kling", "runway", "modelslab", "promptchan"])(
    "video_status accepts provider %s",
    (provider) => {
      expect(ActionSchema.safeParse({ type: "video_status", provider, request_id: "abc" }).success).toBe(true);
    },
  );

  it("video_status rejects an unknown provider", () => {
    expect(ActionSchema.safeParse({ type: "video_status", provider: "not-a-real-provider" }).success).toBe(false);
  });
});
