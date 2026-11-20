import { describe, it, expect } from "vitest";
import {
  convergenceDividend, focusGroupCount, isFragmented, applyYield, isAscensionRitual, activeTrunkSequence, limbMayAdvance,
  pathwayRoot, isGatedLimbSequence, type SefSkill, type SefirotPlan,
} from "../../../supabase/functions/_shared/sefirot";

const sk = (id: string, over: Partial<SefSkill> = {}): SefSkill => ({ id, name: id, tier: 1, proficiency: 0, unlocked: true, parent_skill_id: null, ...over });

describe("convergence", () => {
  it("is 33% of the gain, at least 1 when there is a gain", () => {
    expect(convergenceDividend(6)).toBe(2);
    expect(convergenceDividend(15)).toBe(5);
    expect(convergenceDividend(2)).toBe(1);
    expect(convergenceDividend(0)).toBe(0);
  });
});

describe("anti-dilution", () => {
  const roots = (...m: (string | null)[]) => m.map((b, i) => sk(`p${i}`, { body_mapping: b }));
  it("pathways with the same body mapping are neighbours", () => {
    expect(focusGroupCount(roots("kinetic_limb", "kinetic_limb", "skeletal_law"))).toBe(2);
  });
  it("unmapped pathways each count on their own", () => {
    expect(focusGroupCount(roots(null, null, null))).toBe(3);
  });
  it("more than 3 distinct groups fragments focus and costs 15% yield", () => {
    const four = roots("kinetic_limb", "skeletal_law", "ocular_sense", "quantum_drift");
    expect(isFragmented(four)).toBe(true);
    expect(isFragmented(four.slice(0, 3))).toBe(false);
    expect(applyYield(10, true)).toBe(9); // round(8.5)
    expect(applyYield(2, true)).toBe(2);
    expect(applyYield(10, false)).toBe(10);
  });
});

describe("limb saturation gate", () => {
  it("recognises an Ascension Ritual by category or title", () => {
    expect(isAscensionRitual({ category: "Ascension Ritual" })).toBe(true);
    expect(isAscensionRitual({ title: "Ascension ritual: Lawyer to Barbarian" })).toBe(true);
    expect(isAscensionRitual({ category: "Training", title: "Gym" })).toBe(false);
  });
  it("lets a limb advance only at trunk equilibrium or by ritual", () => {
    const trunkSeqs = [sk("t1", { tier: 1, proficiency: 60 }), sk("t2", { tier: 2, proficiency: 0, unlocked: false })];
    expect(limbMayAdvance(1, trunkSeqs, false)).toBe(false);
    expect(limbMayAdvance(1, trunkSeqs, true)).toBe(true);
    expect(limbMayAdvance(1, [sk("t1", { tier: 1, proficiency: 100 })], false)).toBe(true);
    expect(limbMayAdvance(2, [sk("t1", { tier: 1, proficiency: 100 })], false)).toBe(false);
  });
  it("picks the trunk's highest unlocked sequence as active", () => {
    const all = [sk("t1", { parent_skill_id: "root", tier: 1 }), sk("t2", { parent_skill_id: "root", tier: 2, unlocked: false }), sk("x", { parent_skill_id: "other", tier: 5 })];
    expect(activeTrunkSequence("root", all)?.id).toBe("t1");
  });
  it("gates only direct sequences of an auxiliary pathway", () => {
    const trunk = sk("trunk", { is_sovereign_trunk: true });
    const aux = sk("aux");
    const seq = sk("seq", { parent_skill_id: "aux", tier: 1 });
    const ability = sk("ab", { parent_skill_id: "seq", tier: 1 });
    const trunkSeq = sk("tseq", { parent_skill_id: "trunk" });
    const all = [trunk, aux, seq, ability, trunkSeq];
    const byId = new Map(all.map((s) => [s.id, s]));
    const plan = { trunk, byId, all, auxRoots: [aux], fragmented: false, lockedLinked: [] } as SefirotPlan;
    expect(pathwayRoot("ab", byId)?.id).toBe("aux");
    expect(isGatedLimbSequence(seq, plan)).toBe(true);
    expect(isGatedLimbSequence(ability, plan)).toBe(false);
    expect(isGatedLimbSequence(aux, plan)).toBe(false);
    expect(isGatedLimbSequence(trunkSeq, plan)).toBe(false);
  });
});

import { primaryAxisToAdd } from "../../../supabase/functions/_shared/sefirot";
describe("primary axis auto-link", () => {
  const trunk = sk("trunk", { is_sovereign_trunk: true });
  const aux = sk("aux");
  const seq = sk("seq", { parent_skill_id: "aux", tier: 1 });
  const tseq = sk("tseq", { parent_skill_id: "trunk", tier: 1, proficiency: 12 });
  const all = [trunk, aux, seq, tseq];
  const byId = new Map(all.map((s) => [s.id, s]));
  const plan = (auxRoots: SefSkill[]) => ({ trunk, byId, all, auxRoots, fragmented: false, lockedLinked: [] }) as SefirotPlan;
  it("adds the trunk's active sequence when only a limb is linked", () => {
    expect(primaryAxisToAdd(["seq"], plan([aux]))?.id).toBe("tseq");
  });
  it("adds nothing when a trunk skill is already linked, when no limb is linked, or without a plan", () => {
    expect(primaryAxisToAdd(["seq", "tseq"], plan([aux]))).toBeNull();
    expect(primaryAxisToAdd(["other"], plan([]))).toBeNull();
    expect(primaryAxisToAdd(["seq"], null)).toBeNull();
  });
});

import { frontierSequence, capForLocked, lockedLinkNote } from "../../../supabase/functions/_shared/sefirot";
describe("frontier and locked-skill cap", () => {
  const seqs = (...u: boolean[]) => u.map((unlocked, i) => sk(`s${i + 1}`, { tier: i + 1, unlocked }));
  it("frontier is the end of the unbroken unlocked run from Seq.9", () => {
    expect(frontierSequence(seqs(true, true, false, false))?.id).toBe("s2");
    expect(frontierSequence(seqs(true, false, true, true))?.id).toBe("s1"); // stray unlocks above a gap are ignored
    expect(frontierSequence(seqs(false, true))).toBeNull();
  });
  it("locked Beyonder skills stop at 99%, everything else is unchanged", () => {
    expect(capForLocked(100, false, true)).toBe(99);
    expect(capForLocked(60, false, true)).toBe(60);
    expect(capForLocked(100, true, true)).toBe(100);
    expect(capForLocked(100, false, false)).toBe(100);
  });
  it("explains a locked link and names the current sequence", () => {
    const aux = sk("aux", { name: "Black_Emperor" });
    const cur = sk("cur", { name: "Lawyer", parent_skill_id: "aux", tier: 1 });
    const lockedSeq = sk("lk", { name: "Barbarian", parent_skill_id: "aux", tier: 2, unlocked: false });
    const plan = { trunk: sk("t"), byId: new Map(), all: [aux, cur, lockedSeq], auxRoots: [aux], fragmented: false, lockedLinked: [lockedSeq] } as unknown as SefirotPlan;
    const note = lockedLinkNote(plan) ?? "";
    expect(note).toContain("Barbarian");
    expect(note).toContain("Black Emperor: Lawyer");
    expect(lockedLinkNote({ ...plan, lockedLinked: [] } as SefirotPlan)).toBeNull();
  });
});

import { swapRootsForFrontier } from "../../../supabase/functions/_shared/sefirot";
describe("pathway names resolve to the current sequence", () => {
  const trunk = sk("trunk", { is_sovereign_trunk: true, name: "Black Sun" });
  const aux = sk("aux", { name: "Demoness" });
  const all = [trunk, aux,
    sk("t9", { parent_skill_id: "trunk", tier: 1, name: "Torchbearer" }), sk("t8", { parent_skill_id: "trunk", tier: 2, unlocked: false }),
    sk("a9", { parent_skill_id: "aux", tier: 1, name: "Assassin" }), sk("a8", { parent_skill_id: "aux", tier: 2, unlocked: false })];
  const plan = { trunk, byId: new Map(all.map((s) => [s.id, s])), all, auxRoots: [aux], fragmented: false, lockedLinked: [] } as SefirotPlan;
  it("swaps roots for their frontier sequence and keeps everything else", () => {
    const r = swapRootsForFrontier(["trunk", "aux", "other-skill"], plan);
    expect(r.ids).toEqual(["t9", "a9", "other-skill"]);
    expect(r.swapped).toEqual([{ from: "Black Sun", to: "Torchbearer" }, { from: "Demoness", to: "Assassin" }]);
  });
  it("leaves ids alone with no plan or already-sequence ids", () => {
    expect(swapRootsForFrontier(["a9"], plan).ids).toEqual(["a9"]);
    expect(swapRootsForFrontier(["x"], null).ids).toEqual(["x"]);
  });
});
