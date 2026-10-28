// _shared/beyonderTree.ts
// The Beyonder tree (27 pathways x 10 sequences x 3 abilities, ~1100+ rows)
// is too large and too cross-referenced by raw parent_skill_id UUIDs to dump
// as flat per-row lines like every other skill — at that volume a model
// can't reliably reconstruct which ability belongs to which sequence belongs
// to which pathway, and answers questions about it (or picks a subskill to
// link) by guessing instead of reading. Nest it by name instead: one line
// per sequence (pathway label + tier + proficiency + description + its 3
// abilities inline), grouped under its pathway, every level carrying its
// real database id so a model can link to it instead of inventing one.
//
// Was defined independently in both mavis-chat/promptBuilder.ts (edge
// function) and src/mavis/buildSystemPrompt.ts (frontend, for council mode)
// and had drifted — promptBuilder.ts's copy exposed real ids, the frontend
// copy didn't expose any id at all, not even for the pathway root. One
// shared implementation for every edge function that needs it (the frontend
// keeps its own copy — different runtime/bundler, can't import from here).
export function formatBeyonderTree(beyonderSkills: any[]): string {
  if (beyonderSkills.length === 0) return "";
  const roots = beyonderSkills.filter((s: any) => !s.parent_skill_id).sort((a: any, b: any) => a.name.localeCompare(b.name));
  const lines: string[] = [];
  for (const root of roots) {
    lines.push(`[${root.id}] • ${root.name} — ${root.description || "Pathway"}`);
    const sequences = beyonderSkills
      .filter((s: any) => s.parent_skill_id === root.id)
      .sort((a: any, b: any) => (b.tier ?? 0) - (a.tier ?? 0)); // Seq.9 (tier1) down to Seq.0 (tier10)
    for (const seq of sequences) {
      const seqNum = 10 - (seq.tier ?? 0);
      const abilities = beyonderSkills.filter((s: any) => s.parent_skill_id === seq.id);
      const abilityText = abilities.length
        ? ` Abilities: ${abilities.map((a: any) => `[${a.id}] ${(a.description || a.name).replace(/\.$/, "")}`).join("; ")}.`
        : "";
      lines.push(`  [${seq.id}] Seq.${seqNum} ${seq.name} (T${seq.tier}, prof:${seq.proficiency}%, ${seq.unlocked ? "unlocked" : "locked"}): ${seq.description || ""}${abilityText}`);
    }
  }
  return lines.join("\n");
}
