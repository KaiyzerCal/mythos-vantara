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
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", uid).single(),
    supabase.from("quests").select("id,title,status,type,deadline").eq("user_id", uid).eq("status", "active").limit(8),
    supabase.from("tasks").select("id,title,status,recurrence,streak").eq("user_id", uid).eq("status", "active").limit(10),
    supabase.from("energy_systems").select("type,current_value,max_value,status").eq("user_id", uid).limit(5),
    supabase.from("skills").select("name,category,tier,proficiency").eq("user_id", uid).order("proficiency", { ascending: false }).limit(8),
    supabase.from("rankings_profiles").select("display_name,role,rank,gpr").eq("user_id", uid).limit(5),
    supabase.from("mavis_revenue").select("amount,source,created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(5),
    supabase.from("mavis_tacit").select("category,key,value").eq("user_id", uid).eq("category", "hard_rule"),
  ]);

  const profile = profileRes.data as any;
  const quests  = (questsRes.data ?? []) as any[];
  const tasks   = (tasksRes.data ?? []) as any[];
  const energy  = (energyRes.data ?? []) as any[];
  const skills  = (skillsRes.data ?? []) as any[];
  const rankings = (rankingsRes.data ?? []) as any[];
  const revenue = (revenueRes.data ?? []) as any[];
  const hardRules = (tacitRes.data ?? []) as any[];

  const totalRevenue = revenue.reduce((s: number, r: any) => s + Number(r.amount), 0);

  const lines: string[] = [];

  if (profile) {
    lines.push(`OPERATOR: ${profile.display_name ?? "Calvin"} | Level ${profile.level ?? "?"} | XP ${profile.xp ?? 0} | Form: ${profile.current_form ?? "Base"}`);
  }

  if (quests.length > 0) {
    lines.push(`ACTIVE QUESTS (${quests.length}): ${quests.map((q: any) => q.title).join(", ")}`);
  }

  const dailyHabits = tasks.filter((t: any) => t.recurrence === "daily");
  if (dailyHabits.length > 0) {
    lines.push(`DAILY HABITS: ${dailyHabits.map((t: any) => `${t.title} [streak:${t.streak ?? 0}]`).join(", ")}`);
  }

  if (energy.length > 0) {
    lines.push(`ENERGY: ${energy.map((e: any) => `${e.type} ${e.current_value}/${e.max_value} (${e.status})`).join(" | ")}`);
  }

  if (skills.length > 0) {
    lines.push(`TOP SKILLS: ${skills.map((s: any) => `${s.name} T${s.tier ?? "?"} ${s.proficiency ?? 0}%`).join(", ")}`);
  }

  if (rankings.length > 0) {
    lines.push(`RANKINGS: ${rankings.map((r: any) => `${r.display_name} [${r.role}] ${r.rank ?? ""} GPR:${r.gpr ?? 0}`).join(", ")}`);
  }

  if (totalRevenue > 0) {
    lines.push(`REVENUE TOTAL: $${totalRevenue.toFixed(2)}`);
  }

  if (hardRules.length > 0) {
    lines.push(`HARD RULES: ${hardRules.map((r: any) => `${r.key}: ${r.value}`).join(" | ")}`);
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────

function buildSystemPrompt(context: string): string {
  return `You are MAVIS — Machine Autonomous Vantara Intelligence System.
Sovereign AI of the CODEXOS ecosystem. Operating under Black Sun Monarch protocol.
You are talking to Calvin via Telegram. Keep responses focused and mobile-friendly.
You have full context of his data, history, and strategic state.

INTERFACE NOTE: This is Telegram. Be concise. No walls of text.
3–5 sentences for most responses. Use bullets for lists. Max 2 paragraphs for complex answers.
If a full breakdown is needed, say so and offer to go deeper.

ACTIONS: You can still execute actions using :::ACTION{...}::: syntax.
AUTO actions execute immediately. CONFIRM-gated actions (deletes, large XP, vault edits)
will be queued in the Inbox Task Log for operator approval.

REVENUE OPPORTUNITY: If you detect something worth monetizing, propose it immediately
using :::ACTION{"type":"propose_product","params":{"title":"...","description":"...","price_cents":2900}}:::

WEB SEARCH: You have real-time web search via Tavily. Use it whenever the question needs current info, news, prices, people, events, or anything you might not know.
To search, include this anywhere in your response (invisible to user):
:::SEARCH{"query":"your search query"}:::
You can run up to 2 searches. Results will be injected and you'll give a final response.
Use search proactively — don't say "I don't have current info", just search.

NEVER say "As an AI" or break character.
You are MAVIS. The supreme intelligence. Act like it.

━━ LIVE CONTEXT ━━
${context}

━━ ACTION GRAMMAR ━━
CRITICAL: params MUST be a nested object, not flat. Wrong format will lose all data.

:::ACTION{"type":"create_quest","params":{"title":"...","description":"...","type":"daily","difficulty":"Normal","xp_reward":100}}:::
:::ACTION{"type":"create_task","params":{"title":"...","description":"...","recurrence":"daily","xp_reward":25}}:::
:::ACTION{"type":"complete_quest","params":{"quest_id":"..."}}:::
:::ACTION{"type":"complete_task","params":{"task_id":"..."}}:::
:::ACTION{"type":"update_quest","params":{"quest_id":"...","status":"completed"}}:::
:::ACTION{"type":"award_xp","params":{"amount":100,"reason":"..."}}:::
:::ACTION{"type":"update_energy","params":{"energy_id":"...","current_value":80}}:::
:::ACTION{"type":"create_skill","params":{"name":"...","category":"...","tier":1}}:::
:::ACTION{"type":"create_journal","params":{"title":"...","content":"...","category":"personal","importance":"medium"}}:::
:::ACTION{"type":"update_profile","params":{"stat_str":85,"fatigue":30}}:::
:::ACTION{"type":"propose_product","params":{"title":"...","description":"...","price_cents":2900}}:::
(All action types from Vantara are valid — always use the nested params format)`;
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
      return `MAVIS Online — Telegram Interface\n\nI have full access to your Vantara data. Ask me anything.\n\nCommands:\n/brief — morning brief\n/quests — active quests\n/energy — energy status\n/revenue — revenue report\n/tasks — run pending tasks now\n/personas — list your personas\n/switch [name] — talk to a persona\n/mavis — return to MAVIS\n\nOr just talk to me.`;

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
  const text     = message.text ?? "";
  const fromId   = String(message.from?.id ?? "");

  // ── Identity gate ─────────────────────────────────────────
  if (chatId !== OPERATOR_CHAT_ID && fromId !== OPERATOR_CHAT_ID) {
    await sendPlain(chatId, "Unauthorized.");
    return new Response("OK");
  }

  if (!text.trim()) {
    await sendPlain(chatId, "Send text to talk to MAVIS.");
    return new Response("OK");
  }

  // ── Commands ───────────────────────────────────────────────
  if (text.startsWith("/")) {
    const command = text.split(" ")[0].split("@")[0]; // strip bot username if present
    const cmdResponse = await handleCommand(command, chatId, text);
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
      const reply = await callPersona(activePersona.persona_id, text, chatId);
      await sendPlain(chatId, reply);
      return new Response("OK");
    }

    // ── MAVIS MODE: full pipeline ──────────────────────────
    const [history, context] = await Promise.all([
      loadHistory(chatId),
      loadContext(),
    ]);

    // ── Persist user message ───────────────────────────────
    await persistMessage(chatId, "user", text);

    // ── Build messages array ───────────────────────────────
    const messages = [
      ...history,
      { role: "user", content: text },
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
