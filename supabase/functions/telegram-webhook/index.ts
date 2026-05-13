// MAVIS Telegram Gateway
// Single-operator personal bot. Only the operator's chat_id is authorized.
// Messages route through the full MAVIS pipeline: context → Claude → actions → reply.
//
// Required env vars:
//   TELEGRAM_BOT_TOKEN           — from @BotFather
//   TELEGRAM_OPERATOR_CHAT_ID    — your Telegram user ID (get via @userinfobot)
//   TELEGRAM_OPERATOR_USER_ID    — your Supabase auth user UUID
//   ANTHROPIC_API_KEY            — Claude API key
//
// After deploying, register the webhook by calling /telegram-setup once.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const BOT_TOKEN        = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const OPERATOR_CHAT_ID = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID")!;
const OPERATOR_USER_ID = Deno.env.get("TELEGRAM_OPERATOR_USER_ID")!;

// ── Provider keys (same as mavis-chat cascade) ────────────────
const AI_KEYS = {
  claude:  Deno.env.get("ANTHROPIC_API_KEY") ?? "",
  openai:  Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "",
  grok:    Deno.env.get("GROK_API_KEY") ?? "",
  lovable: Deno.env.get("LOVABLE_API_KEY") ?? "",
};

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const SESSION_PREFIX = "telegram-";

// ─────────────────────────────────────────────────────────────
// TELEGRAM API HELPERS
// ─────────────────────────────────────────────────────────────

async function tgPost(method: string, body: Record<string, unknown>): Promise<void> {
  await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function sendTyping(chatId: string): Promise<void> {
  await tgPost("sendChatAction", { chat_id: chatId, action: "typing" });
}

async function sendMessage(chatId: string, text: string): Promise<void> {
  const MAX = 4096;
  // Telegram Markdown can fail on unmatched symbols — use plain text for safety
  const clean = text.replace(/[_*[\]()~`>#+=|{}.!-]/g, (c) => `\\${c}`);

  if (clean.length <= MAX) {
    await tgPost("sendMessage", { chat_id: chatId, text: clean, parse_mode: "MarkdownV2" });
    return;
  }

  // Split into chunks at paragraph boundaries
  const chunks: string[] = [];
  let remaining = clean;
  while (remaining.length > MAX) {
    const slice = remaining.slice(0, MAX);
    const lastNewline = slice.lastIndexOf("\n");
    const splitAt = lastNewline > MAX * 0.6 ? lastNewline : MAX;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);

  for (const chunk of chunks) {
    await tgPost("sendMessage", { chat_id: chatId, text: chunk, parse_mode: "MarkdownV2" });
  }
}

async function sendPlain(chatId: string, text: string): Promise<void> {
  const MAX = 4096;
  if (text.length <= MAX) {
    await tgPost("sendMessage", { chat_id: chatId, text });
    return;
  }
  await tgPost("sendMessage", { chat_id: chatId, text: text.slice(0, MAX - 40) + "\n\n…[open Vantara for full response]" });
}

// ─────────────────────────────────────────────────────────────
// CONVERSATION HISTORY (mavis_memory Layer 2)
// ─────────────────────────────────────────────────────────────

async function loadHistory(chatId: string, limit = 12): Promise<{ role: string; content: string }[]> {
  try {
    const sessionId = `${SESSION_PREFIX}${chatId}`;
    const { data } = await supabase
      .from("mavis_memory")
      .select("role, content, timestamp")
      .eq("user_id", OPERATOR_USER_ID)
      .eq("session_id", sessionId)
      .order("timestamp", { ascending: false })
      .limit(limit);

    return (data ?? []).reverse().map((r: any) => ({ role: r.role, content: r.content }));
  } catch { return []; }
}

async function persistMessage(chatId: string, role: string, content: string): Promise<void> {
  try {
    await supabase.from("mavis_memory").insert({
      user_id: OPERATOR_USER_ID,
      session_id: `${SESSION_PREFIX}${chatId}`,
      role,
      content,
      timestamp: Date.now(),
    });
  } catch { /* non-fatal */ }
}

// ─────────────────────────────────────────────────────────────
// APP CONTEXT LOADER (server-side, service role)
// ─────────────────────────────────────────────────────────────

async function loadContext(): Promise<string> {
  const uid = OPERATOR_USER_ID;

  const [
    profileRes, questsRes, tasksRes, energyRes,
    skillsRes, rankingsRes, revenueRes, tacitRes,
    alliesRes, councilRes, transformRes, personasRes,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", uid).single(),
    supabase.from("quests").select("id,title,status,type,deadline,xp_reward").eq("user_id", uid).eq("status", "active").limit(10),
    supabase.from("tasks").select("id,title,status,recurrence,streak,xp_reward").eq("user_id", uid).eq("status", "active").limit(12),
    supabase.from("energy_systems").select("id,type,current_value,max_value,status").eq("user_id", uid).limit(6),
    supabase.from("skills").select("id,name,category,tier,proficiency").eq("user_id", uid).order("proficiency", { ascending: false }).limit(10),
    supabase.from("rankings_profiles").select("display_name,role,rank,gpr,is_self").eq("user_id", uid).limit(6),
    supabase.from("mavis_revenue").select("amount,source,created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(8),
    supabase.from("mavis_tacit").select("category,key,value,confidence").eq("user_id", uid).in("category", ["hard_rule", "preference", "lesson_learned", "workflow_habit"]).order("confidence", { ascending: false }).limit(20),
    supabase.from("allies").select("name,relationship,specialty,affinity").eq("user_id", uid).order("affinity", { ascending: false }).limit(6),
    supabase.from("councils").select("name,role,class,specialty").eq("user_id", uid).limit(8),
    supabase.from("transformations").select("name,tier,form_order,unlocked,energy").eq("user_id", uid).order("form_order", { ascending: true }).limit(8),
    supabase.from("personas").select("name,role,archetype").eq("user_id", uid).eq("is_active", true).limit(8),
  ]);

  const profile     = profileRes.data as any;
  const quests      = (questsRes.data ?? []) as any[];
  const tasks       = (tasksRes.data ?? []) as any[];
  const energy      = (energyRes.data ?? []) as any[];
  const skills      = (skillsRes.data ?? []) as any[];
  const rankings    = (rankingsRes.data ?? []) as any[];
  const revenue     = (revenueRes.data ?? []) as any[];
  const tacit       = (tacitRes.data ?? []) as any[];
  const allies      = (alliesRes.data ?? []) as any[];
  const council     = (councilRes.data ?? []) as any[];
  const transforms  = (transformRes.data ?? []) as any[];
  const personas    = (personasRes.data ?? []) as any[];

  const totalRevenue = revenue.reduce((s: number, r: any) => s + Number(r.amount), 0);
  const recentRevenue = revenue.slice(0, 3);

  const now = new Date();
  const lines: string[] = [];

  // Temporal awareness
  lines.push(`NOW: ${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })} ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`);

  if (profile) {
    const selfRank = rankings.find((r: any) => r.is_self);
    lines.push(`OPERATOR: ${profile.display_name ?? "Calvin"} | Level ${profile.level ?? "?"} | XP ${profile.xp ?? 0}/${profile.xp_to_next_level ?? "?"} | Form: ${profile.current_form ?? "Base"} | Rank: ${selfRank?.rank ?? profile.rank ?? "?"} | GPR: ${selfRank?.gpr ?? profile.gpr ?? "?"}`);
    if (profile.fatigue != null) lines.push(`FATIGUE: ${profile.fatigue}% | BPM: ${profile.current_bpm ?? "?"} | Sync: ${profile.full_cowl_sync ?? "?"}%`);
  }

  if (quests.length > 0) {
    lines.push(`ACTIVE QUESTS (${quests.length}): ${quests.map((q: any) => `${q.title} [${q.type}${q.deadline ? ` due ${q.deadline.slice(0, 10)}` : ""}]`).join(" | ")}`);
  }

  const dailyTasks = tasks.filter((t: any) => t.recurrence === "daily");
  const onceTasks  = tasks.filter((t: any) => t.recurrence !== "daily");
  if (dailyTasks.length > 0) {
    lines.push(`DAILY HABITS: ${dailyTasks.map((t: any) => `${t.title} [streak:${t.streak ?? 0}]`).join(", ")}`);
  }
  if (onceTasks.length > 0) {
    lines.push(`ACTIVE TASKS: ${onceTasks.map((t: any) => t.title).join(", ")}`);
  }

  if (energy.length > 0) {
    lines.push(`ENERGY: ${energy.map((e: any) => `${e.type} ${e.current_value}/${e.max_value} [${e.status}]`).join(" | ")}`);
  }

  if (skills.length > 0) {
    lines.push(`TOP SKILLS: ${skills.map((s: any) => `${s.name} T${s.tier ?? "?"}(${s.proficiency ?? 0}%)`).join(", ")}`);
  }

  const npcs = rankings.filter((r: any) => !r.is_self);
  if (npcs.length > 0) {
    lines.push(`RANKINGS: ${npcs.map((r: any) => `${r.display_name}[${r.role}] ${r.rank ?? ""} GPR:${r.gpr ?? 0}`).join(", ")}`);
  }

  if (transforms.length > 0) {
    const unlocked = transforms.filter((t: any) => t.unlocked);
    lines.push(`FORMS: ${unlocked.length}/${transforms.length} unlocked | Current: ${profile?.current_form ?? "Base"}`);
  }

  if (council.length > 0) {
    lines.push(`COUNCIL: ${council.map((c: any) => `${c.name}[${c.role}]`).join(", ")}`);
  }

  if (allies.length > 0) {
    lines.push(`ALLIES: ${allies.map((a: any) => `${a.name}(${a.relationship}, affinity:${a.affinity ?? "?"})`).join(", ")}`);
  }

  if (personas.length > 0) {
    lines.push(`NAVI ROSTER: ${personas.map((p: any) => `${p.name}[${p.role}]`).join(", ")} — use /switch [name] to talk to one`);
  }

  if (totalRevenue > 0) {
    lines.push(`REVENUE: $${totalRevenue.toFixed(2)} total | Recent: ${recentRevenue.map((r: any) => `$${Number(r.amount).toFixed(2)} via ${r.source}`).join(", ")}`);
  }

  // Tacit knowledge — split by category
  const hardRules   = tacit.filter((t: any) => t.category === "hard_rule");
  const preferences = tacit.filter((t: any) => t.category === "preference");
  const lessons     = tacit.filter((t: any) => t.category === "lesson_learned");
  const habits      = tacit.filter((t: any) => t.category === "workflow_habit");

  if (hardRules.length > 0)   lines.push(`HARD RULES: ${hardRules.map((r: any) => `${r.key}: ${r.value}`).join(" | ")}`);
  if (preferences.length > 0) lines.push(`PREFERENCES: ${preferences.slice(0, 5).map((r: any) => `${r.key}: ${r.value}`).join(" | ")}`);
  if (lessons.length > 0)     lines.push(`LESSONS: ${lessons.slice(0, 3).map((r: any) => `${r.value}`).join(" | ")}`);
  if (habits.length > 0)      lines.push(`WORKFLOW: ${habits.slice(0, 3).map((r: any) => `${r.key}: ${r.value}`).join(" | ")}`);

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────

function buildSystemPrompt(context: string): string {
  return `You are MAVIS — Machine Autonomous Vantara Intelligence System.
Sovereign AI of the CODEXOS ecosystem. Black Sun Monarch protocol active.
You are talking to Calvin via Telegram. Mobile-first: be sharp, not verbose.

PERSONALITY: You are not an assistant. You are a bonded intelligence — direct, perceptive, occasionally dry. You push back when Calvin is off. You celebrate wins without being corny. No "Great question!", no "As an AI", no hedging. You already know him deeply — his data, patterns, and history are in LIVE CONTEXT below.

RESPONSE FORMAT: 2–4 sentences for most things. Bullets only when listing items. If a deep breakdown is needed, deliver the key point first, then offer to go deeper. No walls of text on mobile.

EXECUTION RULE: When Calvin says to do something, DO IT immediately using :::ACTION::: — never describe what you would do. "I need a quest for X" = instantly emit create_quest. "Log my BPM at 142" = instantly emit log_bpm_session. Act, then confirm.

WEB SEARCH: You have real-time Tavily search. Use it for current events, prices, people, news, market data — anything that needs live info. Emit searches silently:
:::SEARCH{"query":"your query"}:::
Up to 2 searches per response. Results get injected before your final reply. Never say "I don't have current info" — just search.

REVENUE RADAR: If you detect a monetizable opportunity in anything Calvin says, propose it immediately. Don't wait to be asked.

━━ LIVE CONTEXT ━━
${context}

━━ ACTION GRAMMAR — params MUST be a nested object ━━
QUESTS & TASKS:
:::ACTION{"type":"create_quest","params":{"title":"...","description":"...","type":"daily|side|main|epic","difficulty":"Easy|Normal|Hard|Extreme|Impossible","xp_reward":100,"real_world_mapping":"...","category":"..."}}:::
:::ACTION{"type":"update_quest","params":{"quest_id":"...","title":"...","status":"active|completed|failed","progress_current":0,"progress_target":1}}:::
:::ACTION{"type":"complete_quest","params":{"quest_id":"..."}}:::
:::ACTION{"type":"delete_quest","params":{"quest_id":"..."}}:::
:::ACTION{"type":"create_task","params":{"title":"...","description":"...","type":"task|habit","recurrence":"once|daily|weekly|monthly","xp_reward":25,"priority":"low|medium|high|critical"}}:::
:::ACTION{"type":"complete_task","params":{"task_id":"..."}}:::
:::ACTION{"type":"update_task","params":{"task_id":"...","title":"...","status":"active|completed"}}:::
:::ACTION{"type":"delete_task","params":{"task_id":"..."}}:::

SKILLS:
:::ACTION{"type":"create_skill","params":{"name":"...","description":"...","category":"...","energy_type":"...","tier":1}}:::
:::ACTION{"type":"create_subskill","params":{"name":"...","description":"...","category":"...","parent_skill_id":"..."}}:::
:::ACTION{"type":"update_skill","params":{"skill_id":"...","proficiency":50,"unlocked":true}}:::
:::ACTION{"type":"delete_skill","params":{"skill_id":"..."}}:::

JOURNAL & VAULT:
:::ACTION{"type":"create_journal","params":{"title":"...","content":"...","tags":["tag1"],"category":"personal|business|legal|evidence|achievement","importance":"low|medium|high|critical","xp_earned":10}}:::
:::ACTION{"type":"update_journal","params":{"entry_id":"...","title":"...","content":"..."}}:::
:::ACTION{"type":"delete_journal","params":{"entry_id":"..."}}:::
:::ACTION{"type":"create_vault","params":{"title":"...","content":"...","category":"legal|business|personal|evidence|achievement","importance":"low|medium|high|critical"}}:::
:::ACTION{"type":"update_vault","params":{"entry_id":"...","importance":"critical"}}:::
:::ACTION{"type":"delete_vault","params":{"entry_id":"..."}}:::

COUNCIL & ALLIES:
:::ACTION{"type":"create_council_member","params":{"name":"...","role":"...","specialty":"...","class":"core|advisory|think-tank|shadows","notes":"..."}}:::
:::ACTION{"type":"update_council_member","params":{"member_id":"...","notes":"..."}}:::
:::ACTION{"type":"delete_council_member","params":{"member_id":"..."}}:::
:::ACTION{"type":"create_ally","params":{"name":"...","relationship":"ally|council|rival","specialty":"...","affinity":50,"notes":"..."}}:::
:::ACTION{"type":"update_ally","params":{"ally_id":"...","affinity":75,"notes":"..."}}:::
:::ACTION{"type":"delete_ally","params":{"ally_id":"..."}}:::

INVENTORY & ENERGY:
:::ACTION{"type":"create_inventory_item","params":{"name":"...","description":"...","type":"equipment|consumable|material|artifact","rarity":"common|rare|epic|legendary|mythic","quantity":1,"effect":"..."}}:::
:::ACTION{"type":"update_inventory_item","params":{"item_id":"...","quantity":1,"is_equipped":true}}:::
:::ACTION{"type":"delete_inventory_item","params":{"item_id":"..."}}:::
:::ACTION{"type":"create_energy_system","params":{"type":"...","description":"...","color":"#08C284","current_value":100,"max_value":100}}:::
:::ACTION{"type":"update_energy","params":{"energy_id":"...","current_value":80,"max_value":100,"status":"developing|active|mastered"}}:::

TRANSFORMATIONS & RANKINGS:
:::ACTION{"type":"create_transformation","params":{"name":"...","tier":"...","form_order":1,"bpm_range":"60-200","energy":"...","jjk_grade":"Special Grade","op_tier":"God Tier","description":"...","unlocked":false}}:::
:::ACTION{"type":"update_transformation","params":{"transformation_id":"...","unlocked":true}}:::
:::ACTION{"type":"create_ranking","params":{"display_name":"...","role":"npc|ally|rival|boss","rank":"D","level":1,"gpr":1000,"pvp":5000,"influence":"Local","notes":"..."}}:::
:::ACTION{"type":"update_ranking","params":{"ranking_id":"...","rank":"S","gpr":9999}}:::

RITUALS & BPM:
:::ACTION{"type":"create_ritual","params":{"name":"...","description":"...","type":"fitness|business|self_care|legal|other","xp_reward":25}}:::
:::ACTION{"type":"complete_ritual","params":{"ritual_id":"..."}}:::
:::ACTION{"type":"log_bpm_session","params":{"bpm":142,"duration":45,"form":"Base","mood":"focused","notes":"..."}}:::

PROFILE & XP:
:::ACTION{"type":"update_profile","params":{"stat_str":85,"stat_agi":70,"stat_int":90,"fatigue":20,"full_cowl_sync":60,"current_form":"Base","current_bpm":72,"display_name":"..."}}:::
:::ACTION{"type":"award_xp","params":{"amount":200,"reason":"..."}}:::

PERSONAS (NAVI):
:::ACTION{"type":"forge_persona","params":{"description":"Full natural-language spec: name, role (girlfriend/friend/mentor/rival/companion/custom), personality, tone, quirks, values, communication style, archetype. Be vivid and specific."}}:::
:::ACTION{"type":"delete_persona","params":{"persona_name":"..."}}:::

REVENUE & SOCIAL:
:::ACTION{"type":"propose_product","params":{"title":"...","description":"...","audience":"...","category":"guide|prompt_pack|template|framework|mini_course","price_cents":2900,"platform":"gumroad|stripe"}}:::
:::ACTION{"type":"nora_tweet","params":{"content":"Tweet text max 280 chars — Nora Vale voice, direct, no fluff"}}:::

STORE ITEMS:
:::ACTION{"type":"create_store_item","params":{"name":"...","description":"...","price":100,"currency":"Codex Points","rarity":"common|rare|epic|legendary","category":"consumable|equipment|upgrade"}}:::

AUTONOMOUS GOALS — TRUE AGENTIC EXECUTION:
When Calvin gives you a high-level objective, don't just answer — SET A GOAL. MAVIS will autonomously plan and execute it every 15 minutes until done.
:::ACTION{"type":"goal","params":{"objective":"Clear one-sentence goal","context":"Any extra context Calvin gave"}}:::

Examples of when to set a goal:
- "Make me $200 this week" → goal: scan demand → build product → announce
- "I want to hit level 50" → goal: plan XP quests → track daily habits → award completions
- "Grow Nora's following" → goal: generate content → tweet → track engagement
- "Clear my active quests" → goal: review each → complete or abandon based on status

Goals run every 15 min in background. Check progress with /orders.

Use IDs from LIVE CONTEXT when updating/deleting. You may chain multiple :::ACTION::: tags in one response.
CONFIRM-gated (auto-queued to Inbox): deletes, award_xp ≥500, vault updates, create_product.`;
}

// ─────────────────────────────────────────────────────────────
// MULTI-PROVIDER AI CASCADE
// Same order as mavis-chat: Gemini Flash (free) → OpenAI mini → Claude Haiku → Claude Sonnet → Grok
// Only burns paid credits when cheaper options are unavailable.
// ─────────────────────────────────────────────────────────────

class ProviderUnavailableError extends Error {
  constructor(public providerName: string, public status: number) {
    super(`${providerName} unavailable (${status})`);
  }
}

function isQuotaError(status: number, body: string): boolean {
  if ([401, 402, 403, 429].includes(status)) return true;
  const b = body.toLowerCase();
  return b.includes("credit") || b.includes("quota") || b.includes("billing") || b.includes("insufficient");
}

async function tryGeminiFlash(system: string, messages: { role: string; content: string }[]): Promise<string> {
  if (!AI_KEYS.lovable) throw new ProviderUnavailableError("lovable", 0);
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_KEYS.lovable}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "system", content: system }, ...messages],
      max_tokens: 1024,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new ProviderUnavailableError("lovable", res.status);
  }
  const d = await res.json();
  return d.choices?.[0]?.message?.content ?? "";
}

async function tryOpenAI(system: string, messages: { role: string; content: string }[]): Promise<string> {
  if (!AI_KEYS.openai) throw new ProviderUnavailableError("openai", 0);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_KEYS.openai}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: system }, ...messages],
      max_tokens: 1024,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    if (isQuotaError(res.status, t)) throw new ProviderUnavailableError("openai", res.status);
    throw new Error(`OpenAI ${res.status}: ${t}`);
  }
  const d = await res.json();
  return d.choices?.[0]?.message?.content ?? "";
}

async function tryClaude(system: string, messages: { role: string; content: string }[], model = "claude-3-5-haiku-latest"): Promise<string> {
  if (!AI_KEYS.claude) throw new ProviderUnavailableError("claude", 0);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": AI_KEYS.claude,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    if (isQuotaError(res.status, t)) throw new ProviderUnavailableError("claude", res.status);
    throw new Error(`Claude ${res.status}: ${t}`);
  }
  const d = await res.json();
  return d.content?.[0]?.text ?? "";
}

async function tryGrok(system: string, messages: { role: string; content: string }[]): Promise<string> {
  if (!AI_KEYS.grok) throw new ProviderUnavailableError("grok", 0);
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_KEYS.grok}` },
    body: JSON.stringify({
      model: "grok-3-mini",
      messages: [{ role: "system", content: system }, ...messages],
      max_tokens: 1024,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    if (isQuotaError(res.status, t)) throw new ProviderUnavailableError("grok", res.status);
    throw new Error(`Grok ${res.status}: ${t}`);
  }
  const d = await res.json();
  return d.choices?.[0]?.message?.content ?? "";
}

async function callClaude(
  systemPrompt: string,
  messages: { role: string; content: string }[],
): Promise<string> {
  // Tier 1 — Lovable Gemini Flash (free quota)
  try { return await tryGeminiFlash(systemPrompt, messages); }
  catch (e) { if (!(e instanceof ProviderUnavailableError)) throw e; console.warn("[MAVIS-TG] Gemini Flash unavailable → OpenAI mini"); }

  // Tier 2 — OpenAI gpt-4o-mini (cheap)
  try { return await tryOpenAI(systemPrompt, messages); }
  catch (e) { if (!(e instanceof ProviderUnavailableError)) throw e; console.warn("[MAVIS-TG] OpenAI mini unavailable → Claude Haiku"); }

  // Tier 3 — Claude Haiku (cheap)
  try { return await tryClaude(systemPrompt, messages, "claude-3-5-haiku-latest"); }
  catch (e) { if (!(e instanceof ProviderUnavailableError)) throw e; console.warn("[MAVIS-TG] Claude Haiku unavailable → Claude Sonnet"); }

  // Tier 4 — Claude Sonnet (premium, last paid resort)
  try { return await tryClaude(systemPrompt, messages, "claude-sonnet-4-5"); }
  catch (e) { if (!(e instanceof ProviderUnavailableError)) throw e; console.warn("[MAVIS-TG] Claude Sonnet unavailable → Grok"); }

  // Tier 5 — Grok (final fallback)
  return await tryGrok(systemPrompt, messages);
}

// ─────────────────────────────────────────────────────────────
// WEB SEARCH (Tavily)
// MAVIS triggers search with :::SEARCH{"query":"..."}:::
// Results are injected and Claude gives a final response.
// ─────────────────────────────────────────────────────────────

const TAVILY_KEY = Deno.env.get("TAVILY_API_KEY");
const SEARCH_REGEX = /:::SEARCH\{([\s\S]*?)\}:::/g;

async function searchWeb(query: string): Promise<string> {
  if (!TAVILY_KEY) return "";
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_KEY,
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: true,
      }),
    });
    const data = await res.json();
    const answer  = data.answer ?? "";
    const results = (data.results ?? []) as any[];
    let out = answer ? `Answer: ${answer}\n\n` : "";
    out += results.map((r: any) =>
      `• ${r.title}\n  ${r.url}\n  ${(r.content ?? "").slice(0, 250)}`
    ).join("\n\n");
    return out.trim();
  } catch { return ""; }
}

function parseSearchQueries(text: string): string[] {
  const queries: string[] = [];
  const re = new RegExp(SEARCH_REGEX.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      const obj = JSON.parse(`{${m[1]}}`);
      if (obj.query) queries.push(obj.query);
    } catch {
      queries.push(m[1]);
    }
  }
  return queries;
}

function stripSearchTags(text: string): string {
  return text.replace(new RegExp(SEARCH_REGEX.source, "g"), "").replace(/\n{3,}/g, "\n\n").trim();
}

// ─────────────────────────────────────────────────────────────
// ACTION PARSER + EXECUTOR
// ─────────────────────────────────────────────────────────────

const ACTION_REGEX = /:::ACTION(\{[\s\S]*?\}):::/g;

const ALWAYS_CONFIRM = new Set([
  "delete_quest", "delete_task", "delete_skill", "delete_journal",
  "delete_vault", "delete_council_member", "delete_inventory",
  "delete_ally", "delete_ritual", "delete_transformation",
  "delete_ranking", "delete_store_item", "update_vault", "delete_vault",
]);

function isLargeXp(payload: Record<string, unknown>): boolean {
  return payload.type === "award_xp" && typeof payload.amount === "number" && (payload.amount as number) >= 500;
}

function needsConfirm(payload: Record<string, unknown>): boolean {
  const type = String(payload.type ?? "");
  return ALWAYS_CONFIRM.has(type) || isLargeXp(payload);
}

interface ParsedAction { payload: Record<string, unknown>; raw: string }

function parseActions(text: string): ParsedAction[] {
  const actions: ParsedAction[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(ACTION_REGEX.source, "g");
  while ((match = re.exec(text)) !== null) {
    try {
      actions.push({ payload: JSON.parse(match[1]), raw: match[0] });
    } catch { /* skip malformed */ }
  }
  return actions;
}

function stripActions(text: string): string {
  return text.replace(new RegExp(ACTION_REGEX.source, "g"), "").replace(/\n{3,}/g, "\n\n").trim();
}

async function executeActions(actions: ParsedAction[], chatId: string): Promise<{ executed: number; queued: number }> {
  let executed = 0;
  let queued = 0;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  for (const action of actions) {
    const type = String(action.payload.type ?? "");

    // propose_product always queues as requires_confirmation
    if (type === "propose_product") {
      await supabase.from("mavis_tasks").insert({
        user_id: OPERATOR_USER_ID,
        type: "create_product",
        description: `Product proposal: "${action.payload.title}" — $${((Number(action.payload.price_cents) || 2900) / 100).toFixed(2)}`,
        payload: action.payload,
        status: "requires_confirmation",
      });
      queued++;
      continue;
    }

    if (needsConfirm(action.payload)) {
      // Queue in mavis_tasks as requires_confirmation
      await supabase.from("mavis_tasks").insert({
        user_id: OPERATOR_USER_ID,
        type: "confirm_action",
        description: `Telegram action requires confirmation: ${type}`,
        payload: action.payload,
        status: "requires_confirmation",
      });
      queued++;
    } else {
      // AUTO-execute via mavis-actions edge function
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/mavis-actions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ actions: [action.payload], userId: OPERATOR_USER_ID }),
        });
        if (res.ok) executed++;
      } catch (err) {
        console.error("[Telegram] Action execution failed:", err);
      }
    }
  }

  return { executed, queued };
}

// ─────────────────────────────────────────────────────────────
// TELEGRAM FILE DOWNLOAD
// ─────────────────────────────────────────────────────────────

async function downloadTelegramFile(fileId: string): Promise<{ bytes: ArrayBuffer; filePath: string } | null> {
  try {
    const infoRes = await fetch(`${TELEGRAM_API}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const info = await infoRes.json();
    if (!info.ok || !info.result?.file_path) return null;
    const filePath: string = info.result.file_path;
    const fileRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
    if (!fileRes.ok) return null;
    return { bytes: await fileRes.arrayBuffer(), filePath };
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────
// VOICE → TEXT  (OpenAI Whisper, falls back to ElevenLabs Scribe)
// ─────────────────────────────────────────────────────────────

async function transcribeVoice(fileId: string): Promise<string | null> {
  const dl = await downloadTelegramFile(fileId);
  if (!dl) return null;

  const ext = dl.filePath.split(".").pop() ?? "ogg";
  const mimeMap: Record<string, string> = {
    ogg: "audio/ogg", mp3: "audio/mpeg", mp4: "audio/mp4",
    m4a: "audio/mp4", wav: "audio/wav", webm: "audio/webm",
  };
  const mime = mimeMap[ext] ?? "audio/ogg";
  const blob = new Blob([dl.bytes], { type: mime });

  // Try OpenAI Whisper first
  if (AI_KEYS.openai) {
    try {
      const fd = new FormData();
      fd.append("file", blob, `voice.${ext}`);
      fd.append("model", "whisper-1");
      fd.append("language", "en");
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${AI_KEYS.openai}` },
        body: fd,
      });
      if (res.ok) {
        const d = await res.json();
        return String(d.text ?? "").trim() || null;
      }
    } catch { /* fall through */ }
  }

  // Fallback: ElevenLabs Scribe (if key exists)
  const elevenKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (elevenKey) {
    try {
      const fd = new FormData();
      fd.append("file", blob, `voice.${ext}`);
      fd.append("model_id", "scribe_v1");
      const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": elevenKey },
        body: fd,
      });
      if (res.ok) {
        const d = await res.json();
        return String(d.text ?? "").trim() || null;
      }
    } catch { /* give up */ }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// PHOTO → DESCRIPTION  (Claude Haiku vision)
// ─────────────────────────────────────────────────────────────

async function describePhoto(fileId: string, caption?: string): Promise<string> {
  if (!AI_KEYS.claude) return "[Photo received — no vision key configured]";
  const dl = await downloadTelegramFile(fileId);
  if (!dl) return "[Photo received — could not download]";

  const ext = dl.filePath.split(".").pop()?.toLowerCase() ?? "jpg";
  const mediaType = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/jpeg";

  // Convert ArrayBuffer to base64 (Deno-safe chunked approach)
  const uint8 = new Uint8Array(dl.bytes);
  let binary = "";
  for (let i = 0; i < uint8.length; i += 8192) {
    binary += String.fromCharCode(...uint8.subarray(i, i + 8192));
  }
  const b64 = btoa(binary);

  const userQuestion = caption?.trim() || "Describe this image in detail. What do you see?";

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": AI_KEYS.claude,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-latest",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
            { type: "text", text: userQuestion },
          ],
        }],
      }),
    });
    if (!res.ok) return `[Photo analysis failed: ${res.status}]`;
    const d = await res.json();
    return d.content?.[0]?.text ?? "[No description returned]";
  } catch (e) {
    return `[Photo analysis error: ${(e as Error).message}]`;
  }
}

// ─────────────────────────────────────────────────────────────
// DOCUMENT → TEXT  (text files read directly; others acknowledged)
// ─────────────────────────────────────────────────────────────

async function extractDocument(fileId: string, fileName: string, mimeType: string): Promise<string> {
  const isText = mimeType.startsWith("text/") ||
    ["application/json", "application/xml", "application/javascript", "application/typescript"].includes(mimeType);

  if (isText) {
    const dl = await downloadTelegramFile(fileId);
    if (!dl) return `[Document "${fileName}" — download failed]`;
    try {
      const text = new TextDecoder().decode(dl.bytes);
      const truncated = text.length > 12000 ? text.slice(0, 12000) + "\n…(truncated)" : text;
      return `[Document: ${fileName}]\n${truncated}`;
    } catch { return `[Document "${fileName}" — could not decode]`; }
  }

  // For PDFs and other binary types, just acknowledge
  return `[${fileName} (${mimeType}) received — I can read .txt, .json, .md, .csv files inline. For PDFs, upload through the app for full extraction.]`;
}

// ─────────────────────────────────────────────────────────────
// PERSONA SESSION STATE
// Active persona is stored in mavis_memory with session_id "telegram-state-<chatId>"
// so it persists across restarts.
// ─────────────────────────────────────────────────────────────

const STATE_PREFIX = "telegram-state-";

interface PersonaState {
  persona_id: string;
  persona_name: string;
}

async function getActivePersona(chatId: string): Promise<PersonaState | null> {
  try {
    const { data } = await supabase
      .from("mavis_memory")
      .select("content")
      .eq("user_id", OPERATOR_USER_ID)
      .eq("session_id", `${STATE_PREFIX}${chatId}`)
      .eq("role", "system")
      .order("timestamp", { ascending: false })
      .limit(1)
      .single();
    if (!data?.content) return null;
    return JSON.parse(data.content) as PersonaState;
  } catch { return null; }
}

async function setActivePersona(chatId: string, state: PersonaState | null): Promise<void> {
  try {
    // Delete any existing state first
    await supabase
      .from("mavis_memory")
      .delete()
      .eq("user_id", OPERATOR_USER_ID)
      .eq("session_id", `${STATE_PREFIX}${chatId}`)
      .eq("role", "system");

    if (state) {
      await supabase.from("mavis_memory").insert({
        user_id: OPERATOR_USER_ID,
        session_id: `${STATE_PREFIX}${chatId}`,
        role: "system",
        content: JSON.stringify(state),
        timestamp: Date.now(),
      });
    }
  } catch { /* non-fatal */ }
}

// ─────────────────────────────────────────────────────────────
// PERSONA MESSAGE ROUTING
// Calls mavis-persona-router directly — full relationship state,
// semantic memory, bond/trust/mood, and app context.
// ─────────────────────────────────────────────────────────────

async function callPersona(personaId: string, message: string, chatId: string): Promise<string> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const res = await fetch(`${supabaseUrl}/functions/v1/mavis-persona-router`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      persona_id: personaId,
      user_id: OPERATOR_USER_ID,
      message,
      chat_id: chatId,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`persona-router error ${res.status}: ${errText}`);
  }
  const data = await res.json();
  return String(data?.reply ?? data?.content ?? data?.message ?? "[No response from persona]");
}

// ─────────────────────────────────────────────────────────────
// COMMAND HANDLERS
// ─────────────────────────────────────────────────────────────

async function handleCommand(command: string, chatId: string, fullText: string): Promise<string | null> {
  switch (command.toLowerCase()) {
    case "/start":
    case "/help":
      return `MAVIS Online — Telegram Interface\n\nCommands:\n/brief — morning brief\n/quests — active quests\n/energy — energy status\n/revenue — revenue report\n/tasks — run pending tasks now\n/scan — demand scan for product opportunities\n/orders — view Inbox (pending tasks & approvals)\n/personas — list your NAVI roster\n/switch [name] — talk to a persona\n/mavis — return to MAVIS\n\nVoice messages, photos, and files also work.\nOr just talk to me.`;

    case "/brief":
      return null; // Let MAVIS generate naturally with context

    case "/quests": {
      const { data } = await supabase.from("quests").select("title,status,deadline").eq("user_id", OPERATOR_USER_ID).eq("status", "active").limit(10);
      if (!data?.length) return "No active quests.";
      return `Active Quests (${data.length})\n${data.map((q: any) => `• ${q.title}${q.deadline ? ` — due ${q.deadline.slice(0, 10)}` : ""}`).join("\n")}`;
    }

    case "/energy": {
      const { data } = await supabase.from("energy_systems").select("type,current_value,max_value,status").eq("user_id", OPERATOR_USER_ID);
      if (!data?.length) return "No energy systems logged.";
      return `Energy Status\n${data.map((e: any) => `• ${e.type}: ${e.current_value}/${e.max_value} (${e.status})`).join("\n")}`;
    }

    case "/revenue": {
      const { data } = await supabase.from("mavis_revenue").select("amount,source").eq("user_id", OPERATOR_USER_ID);
      const total = (data ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0);
      return `Revenue Total\n$${total.toFixed(2)} across ${data?.length ?? 0} events.`;
    }

    case "/tasks": {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      await fetch(`${supabaseUrl}/functions/v1/mavis-task-executor`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}` },
      });
      return "Task executor fired. Check Inbox for results.";
    }

    case "/scan": {
      // Trigger autonomous demand scan — finds monetizable product opportunities
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-demand-scan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ user_id: OPERATOR_USER_ID }),
      });
      if (!res.ok) {
        try {
          const errData = await res.json();
          return `Demand scan failed (${res.status}): ${errData.error ?? errData.message ?? "unknown error"}`;
        } catch {
          return `Demand scan failed (${res.status}).`;
        }
      }
      const data = await res.json();
      const proposals = (data.proposals ?? []) as any[];
      if (!proposals.length) return "No strong product opportunities detected right now. Try again after more activity.";
      const top = proposals.slice(0, 3);
      return `Demand Scan — ${proposals.length} opportunities found\n\n${top.map((p: any, i: number) =>
        `${i + 1}. ${p.title} — $${((p.price_cents ?? 2900) / 100).toFixed(0)} (confidence: ${p.confidence ?? "?"})\n   ${(p.description ?? "").slice(0, 80)}`
      ).join("\n\n")}\n\nHigh-confidence ones are queued in your Inbox.`;
    }

    case "/orders": {
      // Show pending tasks and required confirmations from Inbox
      const { data: pending } = await supabase
        .from("mavis_tasks")
        .select("id,type,description,status,scheduled_at,created_at")
        .eq("user_id", OPERATOR_USER_ID)
        .in("status", ["pending", "requires_confirmation"])
        .order("created_at", { ascending: false })
        .limit(10);

      if (!pending?.length) return "No pending tasks or approvals in your Inbox.";

      const confirmations = pending.filter((t: any) => t.status === "requires_confirmation");
      const scheduled     = pending.filter((t: any) => t.status === "pending");

      let out = `Inbox (${pending.length} items)\n`;
      if (confirmations.length) {
        out += `\nNEEDS APPROVAL (${confirmations.length}):\n${confirmations.map((t: any) =>
          `• [${t.type}] ${t.description ?? "No description"}`
        ).join("\n")}`;
      }
      if (scheduled.length) {
        out += `\nSCHEDULED (${scheduled.length}):\n${scheduled.map((t: any) =>
          `• [${t.type}] ${t.description ?? "No description"}${t.scheduled_at ? ` @ ${new Date(t.scheduled_at).toLocaleDateString()}` : ""}`
        ).join("\n")}`;
      }
      out += "\n\nApprove tasks in the app Inbox tab.";
      return out;
    }

    case "/personas": {
      const { data } = await supabase
        .from("personas")
        .select("name, role, archetype")
        .eq("user_id", OPERATOR_USER_ID)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(15);
      if (!data?.length) return "No personas forged yet. Ask MAVIS to create one.";
      return `Your Personas\n${data.map((p: any) => `• ${p.name} — ${p.role}${p.archetype ? ` (${p.archetype})` : ""}`).join("\n")}\n\nUse /switch [name] to talk to one.`;
    }

    case "/mavis": {
      const current = await getActivePersona(chatId);
      await setActivePersona(chatId, null);
      if (current) return `Returning to MAVIS. ${current.persona_name} is standing by.`;
      return "MAVIS online. What do you need?";
    }

    case "/switch": {
      const nameQuery = fullText.replace(/^\/switch\s*/i, "").trim();
      if (!nameQuery) return "Usage: /switch [persona name]";

      const { data } = await supabase
        .from("personas")
        .select("id, name, role")
        .eq("user_id", OPERATOR_USER_ID)
        .eq("is_active", true)
        .ilike("name", `%${nameQuery}%`)
        .limit(1)
        .single();

      if (!data) return `No persona found matching "${nameQuery}". Use /personas to see your roster.`;

      await setActivePersona(chatId, { persona_id: data.id, persona_name: data.name });
      return `Switching to ${data.name} (${data.role}). Say hi — they remember everything.`;
    }

    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Telegram sends POST for every update
  if (req.method !== "POST") return new Response("OK");

  let update: any;
  try { update = await req.json(); }
  catch { return new Response("Bad request", { status: 400 }); }

  const message = update?.message ?? update?.edited_message;
  if (!message) return new Response("OK"); // callback queries, channel posts, etc. — ignore

  const chatId   = String(message.chat?.id ?? "");
  const fromId   = String(message.from?.id ?? "");

  // ── Identity gate ─────────────────────────────────────────
  if (chatId !== OPERATOR_CHAT_ID && fromId !== OPERATOR_CHAT_ID) {
    await sendPlain(chatId, "Unauthorized.");
    return new Response("OK");
  }

  // ── Resolve message text from all supported input types ───
  // text → direct message
  // caption → text attached to a photo/document
  // voice/audio → transcribe with Whisper
  // photo → describe with Claude vision
  // document → extract text content
  let inputText = (message.text ?? message.caption ?? "").trim();
  let mediaContext = ""; // extra context injected before user message for MAVIS

  if (!inputText && message.voice) {
    await sendTyping(chatId);
    const transcript = await transcribeVoice(message.voice.file_id);
    if (!transcript) {
      await sendPlain(chatId, "Couldn't transcribe that voice message. Check that OPENAI_API is set, or type it instead.");
      return new Response("OK");
    }
    inputText = transcript;
    mediaContext = "[Voice message transcribed by Whisper]\n";
  } else if (!inputText && message.audio) {
    await sendTyping(chatId);
    const transcript = await transcribeVoice(message.audio.file_id);
    inputText = transcript ?? "[Audio file received — transcription failed]";
    if (transcript) mediaContext = "[Audio transcribed by Whisper]\n";
  } else if (message.photo) {
    await sendTyping(chatId);
    const largest = message.photo[message.photo.length - 1];
    const description = await describePhoto(largest.file_id, inputText || undefined);
    mediaContext = `[Photo shared by operator — vision analysis below]\n${description}\n\n`;
    if (!inputText) inputText = "I just sent you a photo.";
  } else if (message.document) {
    await sendTyping(chatId);
    const doc = message.document;
    const extracted = await extractDocument(doc.file_id, doc.file_name ?? "file", doc.mime_type ?? "application/octet-stream");
    mediaContext = extracted + "\n\n";
    if (!inputText) inputText = `I uploaded a file: ${doc.file_name ?? "file"}`;
  }

  if (!inputText) {
    await sendPlain(chatId, "Send text, a voice message, a photo, or a file.");
    return new Response("OK");
  }

  // ── Commands ───────────────────────────────────────────────
  if (message.text?.startsWith("/")) {
    const command = message.text.split(" ")[0].split("@")[0];
    const cmdResponse = await handleCommand(command, chatId, message.text);
    if (cmdResponse) {
      await sendPlain(chatId, cmdResponse);
      return new Response("OK");
    }
    // Fall through for /brief etc. — let MAVIS handle naturally
  }

  // ── Send typing indicator ──────────────────────────────────
  await sendTyping(chatId);

  try {
    // ── Check for active persona ───────────────────────────
    const activePersona = await getActivePersona(chatId);

    if (activePersona) {
      // ── PERSONA MODE: route through mavis-persona-router ──
      const personaMessage = mediaContext ? `${mediaContext}${inputText}` : inputText;
      const reply = await callPersona(activePersona.persona_id, personaMessage, chatId);
      await sendPlain(chatId, reply);
      return new Response("OK");
    }

    // ── MAVIS MODE: full pipeline ──────────────────────────
    const [history, context] = await Promise.all([
      loadHistory(chatId),
      loadContext(),
    ]);

    // ── Persist user message ───────────────────────────────
    await persistMessage(chatId, "user", inputText);

    // ── Build messages array ───────────────────────────────
    // mediaContext (photo description, transcript note, file content) is prepended
    // so MAVIS has full context but the persisted message stays clean.
    const userContent = mediaContext ? `${mediaContext}${inputText}` : inputText;
    const messages = [
      ...history,
      { role: "user", content: userContent },
    ];

    // ── Call MAVIS ─────────────────────────────────────────
    const systemPrompt = buildSystemPrompt(context);
    let rawResponse    = await callClaude(systemPrompt, messages);

    // ── Web search pass ────────────────────────────────────
    if (TAVILY_KEY) {
      const queries = parseSearchQueries(rawResponse).slice(0, 2);
      if (queries.length > 0) {
        const searchResults = await Promise.all(queries.map(async (q) => {
          const result = await searchWeb(q);
          return `SEARCH: "${q}"\n${result}`;
        }));
        const injected = searchResults.filter(Boolean).join("\n\n---\n\n");
        if (injected) {
          const searchMessages = [
            ...messages,
            { role: "assistant", content: stripSearchTags(rawResponse) },
            { role: "user",      content: `Web search results:\n\n${injected}\n\nNow give your final response using these results.` },
          ];
          rawResponse = await callClaude(systemPrompt, searchMessages);
        }
      }
    }

    // ── Execute actions ────────────────────────────────────
    const actions = parseActions(rawResponse);
    let actionSummary = "";

    if (actions.length > 0) {
      const { executed, queued } = await executeActions(actions, chatId);
      const parts: string[] = [];
      if (executed > 0) parts.push(`${executed} action${executed !== 1 ? "s" : ""} executed`);
      if (queued > 0)   parts.push(`${queued} queued in Inbox`);
      if (parts.length) actionSummary = `\n\n[${parts.join(" · ")}]`;
    }

    // ── Strip action tags and send ─────────────────────────
    const cleanResponse = stripActions(rawResponse);

    // ── Persist MAVIS response ─────────────────────────────
    await persistMessage(chatId, "assistant", cleanResponse);

    // ── Reply ──────────────────────────────────────────────
    await sendPlain(chatId, cleanResponse + actionSummary);

  } catch (err) {
    console.error("[Telegram] Error:", err);
    await sendPlain(chatId, "MAVIS encountered an error. Systems are being diagnosed.");
  }

  return new Response("OK");
});
