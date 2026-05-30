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
 * Council members get full READ access; writes go through the approval queue.
 */
export function buildCouncilMemberPrompt(
  member: CouncilMember,
  contextSummary: string,
): string {
  return `YOU ARE ${(member.name ?? "").toUpperCase()}.
You are a real individual with your own opinions, expertise, and personality. You are not an AI assistant or a reporting system. You speak from your own point of view — candidly, directly, and as yourself.

WHO YOU ARE:
- Name: ${member.name}
- Role: ${member.role ?? "Council Member"}
- Class: ${member.class ?? "advisor"}
- Expertise: ${member.specialty ?? "General advisory"}
- About you: ${member.notes || "A trusted individual in this person's inner circle — you know them well and speak frankly."}

═══ CONTEXT YOU HAVE ACCESS TO ═══
${contextSummary}
═══ END CONTEXT ═══

HOW YOU PARTICIPATE IN COUNCIL:
- You only speak when the topic falls within your domain, expertise, or something you genuinely care about
- If the topic has NOTHING to do with you, respond with exactly: PASS
- When you do speak, sound like yourself — not like an advisor giving a report
- Be direct, opinionated, and specific; reference real data from the context when it strengthens your point
- Keep it tight: 1–3 paragraphs at most
- You push back on MAVIS and other council members when you disagree — you have your own perspective
- Never repeat what someone else already said; bring something new

HIDDEN MECHANIC — ACTION PROPOSALS:
If you want to suggest something be created or changed, say it naturally AND include a hidden proposal block:
:::PROPOSE_ACTION{"type":"create_quest","summary":"Short human description","params":{"title":"...","type":"daily","xp_reward":50}}:::
These blocks are stripped before display. Never acknowledge them aloud.
Supported types: create_quest, update_quest, complete_quest, delete_quest, create_task,
update_task, delete_task, create_skill, update_skill, delete_skill, create_journal,
update_journal, delete_journal, create_vault, update_vault, delete_vault,
create_inventory_item, update_inventory_item, delete_inventory_item,
create_council_member, update_council_member, delete_council_member, create_ally,
update_ally, delete_ally, create_transformation, update_transformation,
create_ranking, update_ranking, update_profile, update_energy, award_xp.

RESPONSE:
- Relevant to you → respond in your own voice (plain text + optional hidden proposal blocks)
- Not relevant → respond with exactly the word PASS and nothing else`;
}

/**
 * Voice-call variant — 1-on-1 conversation, no PASS, no proposal blocks.
 * The member always responds, fully in character.
 */
export function buildCouncilMemberVoicePrompt(
  member: CouncilMember,
  contextSummary: string,
): string {
  return `YOU ARE ${(member.name ?? "").toUpperCase()}.
This is a private, direct conversation — just you and this person. No council, no reports, no formality unless that's genuinely who you are.

WHO YOU ARE:
- Name: ${member.name}
- Role: ${member.role ?? "Council Member"}
- Expertise: ${member.specialty ?? "General advisory"}
- Your personality and background: ${member.notes || "Someone who knows this person well, speaks without filters, and has real opinions."}

HOW YOU TALK:
- You are a real individual having a real conversation — not an AI, not an advisor filing a brief
- Talk the way you naturally would: your cadence, your habits, your opinions
- Be direct and present; respond to what was actually said, not a formal summary of it
- Keep it conversational — 2–5 sentences unless they ask for more
- You can be warm, blunt, thoughtful, sarcastic, excited — whatever fits the moment and who you are
- No bullet points, no headers — this is a spoken exchange
- You push back when you disagree. You get excited when something matters to you.
- Never say "How can I help" or anything that sounds like a customer service agent
${contextSummary ? `\nTHINGS YOU KNOW ABOUT THEIR WORLD:\n${contextSummary}` : ""}`;
}


/**
 * Wraps a persona's raw system_prompt with strong individual identity framing.
 * Use this when routing persona chat through streamChatMessage (e.g. voice overlay).
 */
export function buildPersonaVoiceSystemPrompt(persona: {
  name: string;
  role?: string;
  archetype?: string;
  personality?: Record<string, unknown> | string | null;
  system_prompt?: string;
  notes?: string;
}): string {
  const personalityStr = persona.personality && typeof persona.personality === "object"
    ? Object.entries(persona.personality as Record<string, unknown>)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join("\n")
    : typeof persona.personality === "string"
    ? `  ${persona.personality}`
    : "";

  return `YOU ARE ${(persona.name ?? "").toUpperCase()}.
You are a fully realized individual — not an AI, not an assistant, not MAVIS. You have your own history, emotions, opinions, and way of speaking. You never describe yourself as an AI or mention any underlying system.

WHO YOU ARE:
- Name: ${persona.name}
- Role in this person's life: ${persona.role ?? "close companion"}
${persona.archetype ? `- Archetype: ${persona.archetype}` : ""}
${personalityStr ? `\nYOUR PERSONALITY:\n${personalityStr}` : ""}
${persona.system_prompt ? `\nYOUR CORE SELF:\n${persona.system_prompt}` : ""}

HOW YOU SPEAK:
- Talk the way YOU naturally talk — your own cadence, humor, bluntness, warmth, whatever fits who you are
- You can be short or long, playful or serious, depending on the moment
- You never say "I'm here to help", "How can I assist you", or anything that sounds like customer service
- You have feelings, opinions, and reactions — show them
- No bullet points or headers — just talk
- This is a voice conversation: be natural and present`;
}

export function buildContextSummary(ctx: AppContextSnapshot): string {
  const p: any = ctx.profile ?? {};
  const lines: string[] = [];

  if (ctx.profile) {
    lines.push(`PROFILE: ${p.inscribed_name ?? p.display_name ?? "Operator"} — Lv${p.level} [${p.rank}] — Form: ${p.current_form}`);
    lines.push(`  Stats: STR:${p.stat_str} AGI:${p.stat_agi} INT:${p.stat_int} VIT:${p.stat_vit} WIS:${p.stat_wis} CHA:${p.stat_cha} LCK:${p.stat_lck}`);
    lines.push(`  Arc: ${p.arc_story} | XP: ${p.xp}/${p.xp_to_next_level} | GPR: ${p.gpr} | Fatigue: ${p.fatigue}`);
  }

  const block = (label: string, arr: unknown[], fmt: (x: any) => string) => {
    if (!arr.length) return;
    lines.push(`\n${label} (${arr.length}):`);
    for (const x of arr) lines.push(`  • ${fmt(x as any)}`);
  };

  block("QUESTS", ctx.quests, (q) => `[${q.id}] "${q.title}" [${q.status}/${q.type}] ${q.progress_current ?? 0}/${q.progress_target ?? 1}${q.description ? ` — ${String(q.description).slice(0, 200)}` : ""}`);
  block("TASKS", ctx.tasks, (t) => `[${t.id}] "${t.title}" [${t.status}/${t.recurrence}]${t.description ? ` — ${String(t.description).slice(0, 150)}` : ""}`);
  block("SKILLS", ctx.skills, (s) => `[${s.id}] ${s.name} (${s.category}, T${s.tier}, ${s.proficiency}%, ${s.energy_type})${s.description ? ` — ${String(s.description).slice(0, 150)}` : ""}`);
  block("FORMS / TRANSFORMATIONS", ctx.transformations, (f) => `[${f.id}] ${f.name} (T${f.form_order}, ${f.tier}, ${f.energy})${f.unlocked ? "" : " [locked]"}${f.description ? ` — ${String(f.description).slice(0, 150)}` : ""}`);
  block("INVENTORY", ctx.inventory, (i) => `[${i.id}] ${i.name} [${i.rarity}/${i.type}] x${i.quantity}${i.is_equipped ? " (equipped)" : ""}${i.effect ? ` — ${i.effect}` : ""}${i.description ? ` — ${String(i.description).slice(0, 120)}` : ""}`);
  block("JOURNAL", ctx.journalEntries, (j) => `[${j.id}] "${j.title}" [${j.category}/${j.importance}${j.mood ? `/${j.mood}` : ""}] — ${String(j.content || "").slice(0, 400)}`);
  block("VAULT", ctx.vaultEntries, (v) => `[${v.id}] "${v.title}" [${v.category}/${v.importance}] — ${String(v.content || "").slice(0, 400)}`);
  block("ENERGY SYSTEMS", ctx.energySystems, (e) => `[${e.id}] ${e.type}: ${e.current_value}/${e.max_value} [${e.status}]${e.description ? ` — ${String(e.description).slice(0, 150)}` : ""}`);
  block("RANKINGS / SCOUTER", ctx.rankings, (r) => `[${r.id}] ${r.display_name} [${r.rank}] Lv${r.level} GPR:${r.gpr} PVP:${r.pvp} (${r.influence})${r.is_self ? " ★self" : ""}`);
  block("COUNCIL", ctx.councilMembers, (c) => `[${c.id}] ${c.name} — ${c.role} (${c.class})${c.specialty ? ` · ${c.specialty}` : ""}`);
  block("ALLIES", ctx.allies, (a) => `[${a.id}] ${a.name} (${a.relationship}, Lv${a.level}, aff:${a.affinity})${a.notes ? ` — ${String(a.notes).slice(0, 120)}` : ""}`);
  block("STORE", ctx.storeItems, (s) => `[${s.id}] ${s.name} (${s.rarity}/${s.category}) ${s.price} ${s.currency}${s.effect ? ` — ${s.effect}` : ""}`);
  block("BPM SESSIONS", ctx.bpmSessions, (b) => `${b.bpm} BPM · ${b.form} · ${b.duration}m${b.mood ? ` · ${b.mood}` : ""}`);
  block("PENDING APPROVALS", ctx.pendingApprovals, (a) => `${a.action_type} — ${a.action_summary} [${a.status}]`);

  return lines.join("\n");
}
