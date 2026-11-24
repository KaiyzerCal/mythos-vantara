import { describe, expect, it } from "vitest";
import { beyonderProgression } from "../voiceContext";

const sk = (o: any) => ({ category: "Beyonder", proficiency: 0, unlocked: false, ...o });

describe("beyonderProgression", () => {
  const rows = [
    sk({ id: "r1", name: "Black Sun", is_sovereign_trunk: true, parent_skill_id: null }),
    sk({ id: "a1", name: "Torchbearer", parent_skill_id: "r1", tier: 1, unlocked: true, proficiency: 100 }),
    sk({ id: "a2", name: "Light Seeker", parent_skill_id: "r1", tier: 2, unlocked: true, proficiency: 45 }),
    sk({ id: "r2", name: "Door", parent_skill_id: null }),
    sk({ id: "d1", name: "Apprentice", parent_skill_id: "r2", tier: 1, unlocked: true, proficiency: 20 }),
    sk({ id: "d2", name: "Trickmaster", parent_skill_id: "r2", tier: 2, unlocked: false, proficiency: 30 }),
  ];
  const out = beyonderProgression(rows).split("\n");
  it("lists the trunk first with its current sequence and proficiency", () => {
    expect(out[0]).toContain("Black Sun (trunk)");
    expect(out[0]).toContain("now Seq.8 Light Seeker [a2] 45%");
  });
  it("shows banked progress ahead of the current sequence", () => {
    expect(out[1]).toContain("now Seq.9 Apprentice [d1] 20%");
    expect(out[1]).toContain("banked ahead: Seq.8 Trickmaster 30%");
  });
  it("stays compact for 33 pathways", () => {
    const many = Array.from({ length: 33 }, (_, i) => [sk({ id: `r${i}`, name: `P${i}`, parent_skill_id: null }), sk({ id: `s${i}`, name: "S", parent_skill_id: `r${i}`, tier: 1, unlocked: true, proficiency: 10 })]).flat();
    expect(beyonderProgression(many).length).toBeLessThan(6000);
  });
});
