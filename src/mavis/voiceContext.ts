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
import { formatBeyonderTree } from "./buildSystemPrompt";

export async function buildVoiceContext(userId: string): Promise<string> {
  const ctx = await loadFullAppContext(userId);
  const allSkills = (ctx.skills || []) as any[];
  const beyonderSkills = allSkills.filter((s) => s.category === "Beyonder");
  const otherSkills = allSkills.filter((s) => s.category !== "Beyonder");

  const skillLines = otherSkills
    .map((s) => `  • [${s.id}] ${s.name} | cat:${s.category} | energy:${s.energy_type} | prof:${s.proficiency}%${s.parent_skill_id ? ` | parent:${s.parent_skill_id}` : ""}`)
    .join("\n");

  const beyonderBlock = beyonderSkills.length
    ? `  BEYONDER PATHWAYS (${beyonderSkills.filter((s) => !s.parent_skill_id).length} pathways, Sequence 9 = least developed down to Sequence 0 = mastery, each sequence has 3 abilities):\n${formatBeyonderTree(beyonderSkills).split("\n").map((l) => `  ${l}`).join("\n")}`
    : "";

  const skillNameById = new Map<string, string>(allSkills.map((s) => [s.id as string, s.name as string]));
  const activeQuests = ((ctx.quests || []) as any[])
    .filter((q) => q.status === "active")
    .map((q) => {
      const linked = (q.linked_skill_ids || []).map((id: string) => skillNameById.get(id) || id);
      return `  • [${q.id}] ${q.title} (${q.type}, ${q.difficulty})${linked.length ? ` | linked_skills:${linked.join(", ")}` : ""}`;
    })
    .join("\n");

  return `SKILLS — use the exact [id] in brackets when linking or referencing a skill, never invent one:
${[skillLines, beyonderBlock].filter(Boolean).join("\n") || "  None"}

ACTIVE QUESTS — use the exact [id] in brackets when updating/completing/deleting a quest:
${activeQuests || "  None"}

When the operator says "pathway" or "my X pathways/skills" they mean a root-level skill (no parent) in that category; "subskill" means anything nested under it. For "a quest for each of my X pathways", create one quest per matching root, linking a relevant subskill under it (not the root). When asked to create or link a quest, search the lists above by category, energy type, name, or description for the best match before asking the operator to clarify.`;
}
