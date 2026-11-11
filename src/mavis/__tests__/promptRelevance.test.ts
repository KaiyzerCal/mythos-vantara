import { describe, it, expect } from "vitest";
import { makeRelevance, pickRelevant, selectBeyonder } from "../promptRelevance";
import { buildSystemPrompt } from "../buildSystemPrompt";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let n = 1;
const NAMES = ["Fool", "Door", "Black Sun", "Moon", "Black Emperor", "Sun", "Tyrant"];
const skills: any[] = [];
for (let i = 0; i < 40; i++) skills.push({ id: uid(n++), name: `Focus skill ${i}`, category: "Mind", tier: 1, proficiency: 5, energy_type: "Focus", unlocked: true, description: "daily discipline" });
for (const nm of NAMES) {
  const root = { id: uid(n++), name: nm, category: "Beyonder", tier: 0, description: `Pathway: ${nm}` };
  skills.push(root);
  for (let t = 1; t <= 10; t++) {
    const seq = { id: uid(n++), name: `${nm} rank ${t}`, category: "Beyonder", tier: t, parent_skill_id: root.id, proficiency: 0, unlocked: t === 1, description: t % 2 ? "persuasion and trickery under pressure" : "combat endurance" };
    skills.push(seq);
    for (let k = 0; k < 3; k++) skills.push({ id: uid(n++), name: `${seq.name} — Ability ${k + 1}`, category: "Beyonder", tier: t, parent_skill_id: seq.id, description: "a trainable feat" });
  }
}
const quests = Array.from({ length: 120 }, (_, i) => ({
  id: uid(5000 + i), title: i === 77 ? "Finish the eclipse manuscript chapter" : `Quest ${i}`, status: i < 40 ? "active" : "completed", type: "side", difficulty: "medium",
  xp_reward: 50, progress_current: 0, progress_target: 1, description: "A long description of what this quest is about, padded to a realistic length for a real quest entry in the system.", linked_skill_ids: [] as string[],
  updated_at: new Date(Date.now() - i * 86400000).toISOString(),
}));
const journalEntries = Array.from({ length: 60 }, (_, i) => ({ id: uid(7000 + i), title: i === 9 ? "Eclipse manuscript notes" : `Entry ${i}`, category: "personal", importance: "medium", xp_earned: 10, tags: [] as string[], content: "x".repeat(900), created_at: new Date(Date.now() - i * 3600000).toISOString() }));
const vaultEntries = Array.from({ length: 80 }, (_, i) => ({ id: uid(8000 + i), title: `Vault ${i}`, category: "business", importance: "high", content: "y".repeat(900), created_at: new Date(Date.now() - i * 3600000).toISOString() }));
const profile: any = { inscribed_name: "Calvin", level: 10, rank: "F", current_form: "Base", arc_story: "arc" };
const ctx: any = { quests, skills, journalEntries, vaultEntries, tasks: [], councils: [], allies: [], energySystems: [], inventory: [], transformations: [], bpmSessions: [], storeItems: [], rankings: [] };

describe("promptRelevance", () => {
  it("ranks by keyword overlap, then boost, then recency", () => {
    const rel = makeRelevance("help me with the eclipse manuscript");
    const picked = pickRelevant(quests, rel, 5, (q: any) => q.title, (q: any) => new Date(q.updated_at).getTime(), (q: any) => (q.status === "active" ? 1 : 0));
    expect([...picked].some((q: any) => q.title.includes("eclipse manuscript"))).toBe(true); // a completed quest still wins on relevance
    expect([...picked].filter((q: any) => q.status === "active").length).toBe(4);
  });
  it("shows every pathway root, and a named pathway's whole subtree", () => {
    const beyonder = skills.filter((s) => s.category === "Beyonder");
    const shown = selectBeyonder(beyonder, makeRelevance("let's work on my black sun pathway"));
    expect(shown.filter((s) => !s.parent_skill_id).length).toBe(NAMES.length);
    const blackSun = beyonder.find((s) => s.name === "Black Sun");
    expect(shown.filter((s) => s.parent_skill_id === blackSun.id).length).toBe(10);
    expect(shown.length).toBe(NAMES.length + 10 + 30);
  });
  it("with no named pathway, pulls the best-matching sequences only", () => {
    const beyonder = skills.filter((s) => s.category === "Beyonder");
    const shown = selectBeyonder(beyonder, makeRelevance("I want to train persuasion and trickery"));
    expect(shown.length).toBe(NAMES.length + 6 + 18);
  });
});

describe("buildSystemPrompt trimming", () => {
  const focused = buildSystemPrompt(profile, "PRIME", ctx, undefined, undefined, "help me with the eclipse manuscript");
  it("keeps the relevant items in full and the rest compact", () => {
    expect(focused).toContain("Finish the eclipse manuscript chapter | type:side | status:completed");
    expect(focused).toContain("Eclipse manuscript notes | cat:personal | importance:medium");
    expect(focused).toMatch(/completed\/inactive quests not listed/);
    expect(focused).toContain("(compact)");
  });
  it("never drops an active quest or a pathway root entirely", () => {
    for (const q of quests.filter((x) => x.status === "active")) expect(focused).toContain(`[${q.id}]`);
    for (const nm of NAMES) expect(focused).toContain(`• ${nm} — Pathway: ${nm}`);
  });
  it("is far smaller than listing everything", () => {
    const everything = quests.length * 330 + journalEntries.length * 600 + vaultEntries.length * 580 + skills.length * 120;
    const dataPart = focused.length - buildSystemPrompt(profile, "PRIME", { ...ctx, quests: [], skills: [], journalEntries: [], vaultEntries: [] }, undefined, undefined, "x").length;
    expect(dataPart).toBeLessThan(everything * 0.35);
  });
});
