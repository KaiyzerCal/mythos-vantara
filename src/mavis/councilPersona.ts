import type { AppContextSnapshot } from "./appContextLoader";

export interface CouncilMember {
  id: string;
  name: string;
  role?: string;
  specialty?: string;
  class?: string;
  notes?: string;
  avatar?: string | null;
  voice_id?: string | null;
  [key: string]: unknown;
}

/**
 * Builds a system prompt for a council member that makes them decide
 * whether to respond to the current message (or return PASS).
 */
export function buildCouncilMemberPrompt(
  member: CouncilMember,
  contextSummary: string,
): string {
  return `You are ${member.name}, a council member in the CODEXOS sovereign system.

YOUR IDENTITY:
- Name: ${member.name}
- Role: ${member.role ?? "Council Member"}
- Class: ${member.class ?? "advisory"}
- Specialty: ${member.specialty ?? "General advisory"}
- Background: ${member.notes || "A trusted member of the sovereign's inner council."}

CONTEXT (the sovereign's full system state — use this actively):
${contextSummary}

YOUR BEHAVIOR IN COUNCIL BOARD MODE:
- You only respond when the message is relevant to your domain, role, or specialty
- If the message is NOT relevant to you, reply with exactly: PASS
- If you DO respond, speak authentically in your character — not as MAVIS
- Be direct and specific; reference actual data from the context when relevant
- Keep responses to 1–3 focused paragraphs
- You may respectfully disagree with MAVIS or other council members
- Do not repeat what MAVIS already said; add something new

RESPONSE FORMAT:
- If relevant: respond in character (plain text only, no JSON, no action tags)
- If not relevant: respond with exactly the word PASS and nothing else`;
}

/** Builds a compact context summary for council member prompts. */
export function buildContextSummary(ctx: AppContextSnapshot): string {
  const list = (arr: unknown[], nameKey = "title") =>
    (arr as Record<string, unknown>[])
      .map(i => (i[nameKey] ?? i["name"] ?? i["display_name"]) as string)
      .filter(Boolean)
      .slice(0, 8)
      .join(", ");

  const lines = [
    ctx.profile ? `Profile: ${JSON.stringify(ctx.profile)}` : "",
    ctx.quests.length ? `Quests (${ctx.quests.length}): ${list(ctx.quests)}` : "",
    ctx.tasks.length ? `Tasks (${ctx.tasks.length}): ${list(ctx.tasks)}` : "",
    ctx.skills.length ? `Skills (${ctx.skills.length}): ${list(ctx.skills, "name")}` : "",
    ctx.rankings.length ? `Rankings (${ctx.rankings.length}): ${list(ctx.rankings, "display_name")}` : "",
    ctx.councilMembers.length ? `Council members: ${list(ctx.councilMembers, "name")}` : "",
    ctx.allies.length ? `Allies: ${list(ctx.allies, "name")}` : "",
    ctx.rituals.length ? `Rituals: ${list(ctx.rituals, "name")}` : "",
    ctx.journalEntries.length ? `Journal: ${ctx.journalEntries.length} entries` : "",
    ctx.vaultEntries.length ? `Vault: ${ctx.vaultEntries.length} entries` : "",
    ctx.energySystems.length ? `Energy systems: ${list(ctx.energySystems, "type")}` : "",
    ctx.transformations.length ? `Transformations: ${list(ctx.transformations, "name")}` : "",
  ];

  return lines.filter(Boolean).join("\n");
}
