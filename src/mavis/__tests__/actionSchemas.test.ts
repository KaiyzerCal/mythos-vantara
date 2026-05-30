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
    const result = ActionSchema.safeParse({
      type: "create_task",
      title: "Write docs",
      priority: "high",
      due_date: "2026-06-01",
    });
    expect(result.success).toBe(true);
  });

  it("rejects create_task with invalid priority", () => {
    const result = ActionSchema.safeParse({ type: "create_task", title: "Task", priority: "extreme" });
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
    const valid = ActionSchema.safeParse({ type: "create_ranking", title: "Elite" });
    expect(valid.success).toBe(true);

    // Ranking must not accept transformation-only fields
    const contaminated = ActionSchema.safeParse({ type: "create_ranking", title: "Elite", phase: "Ascension" });
    expect(contaminated.success).toBe(false);
  });

  it("validates create_transformation and rejects ranking fields", () => {
    const valid = ActionSchema.safeParse({ type: "create_transformation", title: "Shadow Form" });
    expect(valid.success).toBe(true);

    // Transformation must not accept ranking-only fields
    const contaminated = ActionSchema.safeParse({ type: "create_transformation", title: "Shadow Form", rank: "S" });
    expect(contaminated.success).toBe(false);
  });

  it("validates create_skill with level bounds", () => {
    const valid = ActionSchema.safeParse({ type: "create_skill", title: "Focus", level: 50 });
    expect(valid.success).toBe(true);

    const overMax = ActionSchema.safeParse({ type: "create_skill", title: "Focus", level: 101 });
    expect(overMax.success).toBe(false);
  });

  it("validates create_ally with trust_level bounds", () => {
    const valid = ActionSchema.safeParse({ type: "create_ally", name: "Cipher", trust_level: 7 });
    expect(valid.success).toBe(true);

    const overMax = ActionSchema.safeParse({ type: "create_ally", name: "Cipher", trust_level: 11 });
    expect(overMax.success).toBe(false);
  });

  it("rejects unknown action type", () => {
    const result = ActionSchema.safeParse({ type: "explode_everything" });
    expect(result.success).toBe(false);
  });
});
