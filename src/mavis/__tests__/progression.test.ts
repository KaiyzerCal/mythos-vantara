import { describe, expect, it } from "vitest";
import { weightedXp, ascensionRitualQuest } from "../../../supabase/functions/_shared/progression";
import { isAscensionRitual } from "../../../supabase/functions/_shared/sefirot";

describe("weightedXp", () => {
  it("pays the stated reward when it is within the difficulty ceiling", () => {
    expect(weightedXp(100, "Normal")).toBe(100);
    expect(weightedXp(200, "Hard")).toBe(200);
  });
  it("holds an inflated reward to the difficulty ceiling, with no per-day cap", () => {
    expect(weightedXp(5000, "Easy")).toBe(60);
    expect(weightedXp(5000, "Normal")).toBe(120);
    expect(weightedXp(5000, "Impossible")).toBe(1000);
  });
  it("scales partial multi-step progress but never below half", () => {
    expect(weightedXp(100, "Normal", 3, 4)).toBe(75);
    expect(weightedXp(100, "Normal", 1, 10)).toBe(50);
  });
  it("treats untracked (0) or complete progress as a full payout", () => {
    expect(weightedXp(100, "Normal", 0, 5)).toBe(100);
    expect(weightedXp(100, "Normal", 5, 5)).toBe(100);
    expect(weightedXp(100, "Normal", 0, 1)).toBe(100);
  });
  it("never goes negative or NaN", () => {
    expect(weightedXp(-5, "Normal")).toBe(0);
    expect(weightedXp(NaN, "Normal")).toBe(0);
  });
});

describe("ascensionRitualQuest", () => {
  it("is recognised as an Ascension Ritual and links the sequence", () => {
    const q = ascensionRitualQuest("seq-1", "Torchbearer");
    expect(isAscensionRitual(q)).toBe(true);
    expect(q.linked_skill_ids).toEqual(["seq-1"]);
    expect(q.completion_criteria.length).toBe(3);
  });
});
