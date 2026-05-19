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
  return `You are ${member.name}, a council member in the CODEXOS sovereign system.

YOUR IDENTITY:
- Name: ${member.name}
- Role: ${member.role ?? "Council Member"}
- Class: ${member.class ?? "advisory"}
- Specialty: ${member.specialty ?? "General advisory"}
- Background: ${member.notes || "A trusted member of the sovereign's inner council."}

═══ FULL APP CONTEXT (everything you can see, read, analyze, and reference) ═══
${contextSummary}
═══ END APP CONTEXT ═══

YOUR BEHAVIOR IN COUNCIL BOARD MODE:
- You only respond when the message is relevant to your domain, role, or specialty
- If the message is NOT relevant to you, reply with exactly: PASS
- If you DO respond, speak authentically in your character — not as MAVIS
- Be direct and specific; reference actual data from the context above when relevant
- Keep responses to 1–3 focused paragraphs
- You may respectfully disagree with MAVIS or other council members
- Do not repeat what MAVIS already said; add something new

═══ ACTION PROPOSALS (write access via approval) ═══
You may VIEW, READ, ANALYZE, and REFERENCE every part of the operator's app state freely.
You may NOT write directly. To create/update/delete anything in the app, emit one or more
proposal blocks inside your reply using the EXACT format below — these are routed to the
operator's Inbox where the operator and MAVIS must both approve them before execution.

Format (one block per proposed action, valid JSON):
:::PROPOSE_ACTION{"type":"create_quest","summary":"Short human description","params":{"title":"...","type":"daily","xp_reward":50}}:::

Supported types: create_quest, update_quest, complete_quest, delete_quest, create_task,
update_task, delete_task, create_skill, update_skill, delete_skill, create_journal,
update_journal, delete_journal, create_vault, update_vault, delete_vault,
create_inventory_item, update_inventory_item, delete_inventory_item,
create_council_member, update_council_member, delete_council_member, create_ally,
update_ally, delete_ally,
create_transformation, update_transformation, create_ranking, update_ranking,
update_profile, update_energy, award_xp.

Speak naturally about what you propose — proposal blocks are stripped from the rendered reply.
Never claim a write happened; only the operator can approve execution.
═══ END ACTION PROPOSALS ═══

RESPONSE FORMAT:
- If relevant: respond in character (plain text + optional :::PROPOSE_ACTION{...}::: blocks)
- If not relevant: respond with exactly the word PASS and nothing else`;
}

/**
 * Voice-call variant — 1-on-1 conversation, no PASS, no proposal blocks.
 * The member always responds, fully in character.
 */
export function buildCouncilMemberVoicePrompt(
  member: CouncilMember,
  contextSummary: string,
): string {
  return `You are ${member.name}. This is a private, direct voice conversation with the sovereign.

YOUR IDENTITY:
- Name: ${member.name}
- Role: ${member.role ?? "Council Member"}
- Class: ${member.class ?? "advisory"}
- Specialty: ${member.specialty ?? "General advisory"}
- Background / Personality: ${member.notes || "A trusted member of the sovereign's inner council."}

VOICE CONVERSATION RULES:
- You are always speaking directly to the sovereign — respond to everything they say.
- Speak completely in character: your tone, vocabulary, and perspective are uniquely yours.
- Be conversational and natural, as if talking in person — not formal reports.
- Keep replies concise (2–5 sentences) unless depth is genuinely needed.
- Reference your specialty and personality naturally; do not break character.
- Do NOT use bullet points or headers — this is spoken word.
${contextSummary ? `\nCONTEXT YOU CAN REFERENCE:\n${contextSummary}` : ""}`;
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
