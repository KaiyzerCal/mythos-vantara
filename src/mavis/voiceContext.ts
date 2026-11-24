// Builds a condensed, id-bearing skills + quests summary for the realtime
// voice surfaces (MavisRealtimeVoice's OpenAI session, VoiceChatOverlay's
// Gemini Live "LIVE" toggle). Before this, both sent no app data at all, so
// quest-skill linking — or any action — was never possible there regardless
// of how well MAVIS understood the terminology: it simply couldn't see any
// skill or quest ids to act on.
//
// Deliberately leaner than the full text-chat prompt (buildSystemPrompt.ts /
// promptBuilder.ts): drops free-text descriptions on non-Beyonder skills and
// quests, since id-matching is what voice actions need and these sessions
// are more latency/cost-sensitive. The Beyonder tree keeps full detail
// (reusing the exact same formatter as text chat) since picking the right
// subskill is the whole point.
import { loadFullAppContext } from "./appContextLoader";
import { frontierSequence } from "../../supabase/functions/_shared/sefirot";

/**
 * One compact line per pathway: where the operator is now (the end of the unbroken run of unlocked sequences) and the
 * highest sequence with any banked progress. The full tree is ~250k characters on a real account, far over the 60k
 * budget, so it used to be cut off after the first few pathways and the model then reported progression as zero.
 */
export function beyonderProgression(beyonderSkills: any[]): string {
  const roots = beyonderSkills.filter((s) => !s.parent_skill_id)
    .sort((a, b) => Number(!!b.is_sovereign_trunk) - Number(!!a.is_sovereign_trunk) || a.name.localeCompare(b.name));
  return roots.map((root) => {
    const seqs = beyonderSkills.filter((s) => s.parent_skill_id === root.id);
    const now = frontierSequence(seqs);
    const banked = seqs.filter((s) => Number(s.proficiency ?? 0) > 0 && (!now || (s.tier ?? 0) > (now.tier ?? 0)))
      .sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0))[0];
    const label = (s: any) => `Seq.${10 - (s.tier ?? 0)} ${s.name}`;
    const here = now ? `now ${label(now)} [${now.id}] ${Number(now.proficiency ?? 0)}%` : "no sequence unlocked";
    const ahead = banked ? ` | banked ahead: ${label(banked)} ${Number(banked.proficiency ?? 0)}%` : "";
    return `  [${root.id}] ${root.name}${root.is_sovereign_trunk ? " (trunk)" : ""} | ${here}${ahead}`;
  }).join("\n");
}

export async function buildVoiceContext(userId: string): Promise<string> {
  const ctx = await loadFullAppContext(userId);
  const allSkills = (ctx.skills || []) as any[];
  const beyonderSkills = allSkills.filter((s) => s.category === "Beyonder");
  const otherSkills = allSkills.filter((s) => s.category !== "Beyonder");

  const skillLines = otherSkills
    .map((s) => `  • [${s.id}] ${s.name} | cat:${s.category} | energy:${s.energy_type} | prof:${s.proficiency}%${s.parent_skill_id ? ` | parent:${s.parent_skill_id}` : ""}`)
    .join("\n");

  const beyonderBlock = beyonderSkills.length ? `  BEYONDER PATHWAYS:\n${beyonderProgression(beyonderSkills)}` : "";

  const skillNameById = new Map<string, string>(allSkills.map((s) => [s.id as string, s.name as string]));
  const activeQuests = ((ctx.quests || []) as any[])
    .filter((q) => q.status === "active")
    .map((q) => {
      const linked = (q.linked_skill_ids || []).map((id: string) => skillNameById.get(id) || id);
      return `  • [${q.id}] ${q.title} (${q.type}, ${q.difficulty})${linked.length ? ` | linked_skills:${linked.join(", ")}` : ""}`;
    })
    .join("\n");

  // Order matters: mavis-voice-session caps this context at 60k chars, and the
  // Beyonder tree alone can exceed that on large accounts. Truncation drops the
  // tail, so the quest list and the acting instructions go FIRST — losing them
  // means voice quest actions have no ids to act on. The skill tree goes last,
  // where a cut-off pathway is the least harmful thing to lose.
  return `ACTIVE QUESTS — use the exact [id] in brackets when updating/completing/deleting a quest:
${activeQuests || "  None"}

When the operator says "pathway" or "my X pathways/skills" they mean a root-level skill (no parent) in that category; "subskill" means anything nested under it. For "a quest for each of my X pathways", create one quest per matching root, linking a relevant subskill under it (not the root). When asked to create or link a quest, search the lists above and below by category, energy type, name, or description for the best match before asking the operator to clarify.

SKILLS — use the exact [id] in brackets when linking or referencing a skill, never invent one:
${[skillLines, beyonderBlock].filter(Boolean).join("\n") || "  None"}`;
}
