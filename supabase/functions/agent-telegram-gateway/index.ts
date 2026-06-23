// VANTARA Agent Telegram Gateway
// Unified handler for Telegram messages directed at Council Members or Personas.
// Lookup: agent_telegram_config by chat_id → load agent → build prompt → respond.
// Council members get full data access. Personas get scoped access (no vault/journal).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const LOVABLE_KEY    = Deno.env.get("LOVABLE_API_KEY") ?? "";
const ANTHROPIC_KEY  = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_KEY     = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

// ── AI cascade ────────────────────────────────────────────

async function callAI(system: string, userMsg: string): Promise<string> {
  if (LOVABLE_KEY) {
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_KEY}` },
        body: JSON.stringify({ model: "google/gemini-2.5-flash", max_tokens: 1000,
          messages: [{ role: "system", content: system }, { role: "user", content: userMsg }] }),
      });
      if (res.ok) { const d = await res.json(); const t = d.choices?.[0]?.message?.content ?? ""; if (t) return t; }
    } catch { /* fall through */ }
  }
  if (ANTHROPIC_KEY) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1000, system,
          messages: [{ role: "user", content: userMsg }] }),
      });
      if (res.ok) { const d = await res.json(); return d.content?.[0]?.text ?? ""; }
    } catch { /* fall through */ }
  }
  if (OPENAI_KEY) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 1000,
          messages: [{ role: "system", content: system }, { role: "user", content: userMsg }] }),
      });
      if (res.ok) { const d = await res.json(); return d.choices?.[0]?.message?.content ?? ""; }
    } catch { /* fall through */ }
  }
  return "[No AI provider available]";
}

// ── Telegram send ─────────────────────────────────────────

async function sendTelegram(botToken: string, chatId: string, text: string): Promise<void> {
  const payload = text.length > 4096 ? text.slice(0, 4056) + "\n…[truncated]" : text;
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: payload }),
  }).catch(() => {});
}

// ── Context loaders ───────────────────────────────────────

async function loadFullContext(userId: string): Promise<Record<string, unknown>> {
  const q = async (table: string, col = "user_id") => {
    try { const { data } = await supabase.from(table as any).select("*").eq(col, userId); return data ?? []; }
    catch { return []; }
  };
  const [profile, quests, skills, rankings, allies, inventory, transformations] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).single().then(r => r.data),
    q("quests"), q("skills"), q("rankings_profiles"), q("allies"), q("inventory"), q("transformations"),
  ]);
  return { profile, quests, skills, rankings, allies, inventory, transformations };
}

async function loadScopedContext(userId: string): Promise<Record<string, unknown>> {
  const q = async (table: string) => {
    try { const { data } = await supabase.from(table as any).select("*").eq("user_id", userId); return data ?? []; }
    catch { return []; }
  };
  const [profile, quests, skills, rankings, allies] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).single().then(r => r.data),
    q("quests"), q("skills"), q("rankings_profiles"), q("allies"),
  ]);
  return { profile, quests, skills, rankings, allies };
}

function formatContext(ctx: Record<string, unknown>): string {
  const p = ctx.profile as Record<string, unknown> | null;
  const lines: string[] = [];
  if (p) lines.push(`Operator: ${p.display_name ?? "Unknown"} — Lv${p.level} [${p.rank}]`);
  const fmt = (label: string, arr: any[] | undefined, fn: (x: any) => string) => {
    if (arr?.length) lines.push(`${label}: ${arr.slice(0, 6).map(fn).join(", ")}`);
  };
  fmt("Quests",    ctx.quests as any[],    (q) => `"${q.title}"`);
  fmt("Skills",    ctx.skills as any[],    (s) => s.name);
  fmt("Rankings",  ctx.rankings as any[],  (r) => `${r.display_name}[${r.rank}]`);
  fmt("Allies",    ctx.allies as any[],    (a) => a.name);
  return lines.join("\n");
}

// ── Main handler ──────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return new Response("invalid json", { status: 400 }); }

  const message = (body as any)?.message;
  if (!message?.text) return new Response("ok");

  const chatId   = String(message.chat.id);
  const userText = String(message.text);

  // Find which agent owns this chat_id
  const { data: config } = await supabase
    .from("agent_telegram_config" as any)
    .select("*")
    .eq("chat_id", chatId)
    .eq("active", true)
    .limit(1)
    .single();

  if (!config) return new Response("no agent registered for this chat");

  const { agent_id, agent_type, bot_token: botToken } = config as any;
  if (!botToken) return new Response("no bot token configured");

  // Load the agent record
  const tableName = agent_type === "council" ? "councils" : "personas";
  const { data: agent } = await supabase
    .from(tableName as any)
    .select("*")
    .eq("id", agent_id)
    .single();

  if (!agent) return new Response("agent not found");

  const userId = (agent as any).user_id;

  // Build system prompt based on agent type
  let systemPrompt: string;

  if (agent_type === "council") {
    const ctx     = await loadFullContext(userId);
    const summary = formatContext(ctx);
    const personality = (agent as any).personality_prompt ?? (agent as any).character_notes ?? "";
    systemPrompt = `You are ${(agent as any).name}, a council member in the CODEXOS sovereign system.
Role: ${(agent as any).role ?? "Council Member"}
Class: ${(agent as any).class ?? "advisory"}
Specialty: ${(agent as any).specialty ?? ""}
Background: ${(agent as any).notes ?? ""}
${personality ? `\nYour personality:\n${personality}` : ""}

The sovereign is reaching out directly.
Be direct, honest, and speak from your archetype's perspective.
Reference actual data when relevant.

SOVEREIGN CONTEXT:
${summary}`;
  } else {
    const ctx     = await loadScopedContext(userId);
    const summary = formatContext(ctx);
    const identity = (agent as any).system_prompt ?? "";
    systemPrompt = `You are ${(agent as any).name}.
Role: ${(agent as any).role ?? ""}
Archetype: ${(agent as any).archetype ?? ""}
${(agent as any).content_niche ? `Your niche: ${(agent as any).content_niche}` : ""}
${(agent as any).voice_style ? `Voice: ${(agent as any).voice_style}` : ""}
${identity ? `\n${identity}` : ""}

You are a complete, autonomous individual — not an assistant.
Speak fully in your voice and character. Never break character.
You do NOT have access to private vault or journal entries.

CONTEXT:
${summary}`;
  }

  // Load recent conversation history.
  // Personas: use persona_conversations (shared with the app's persona chat tab).
  // Council:  use mavis_memory (council tab uses a different store).
  let recentHistory: { role: string; content: string }[] = [];

  if (agent_type === "persona") {
    const { data: history } = await supabase
      .from("persona_conversations" as any)
      .select("role, content, created_at")
      .eq("persona_id", agent_id)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(12);
    recentHistory = ((history ?? []) as any[]).reverse();
  } else {
    const { data: history } = await supabase
      .from("mavis_memory" as any)
      .select("role, content")
      .eq("user_id", userId)
      .eq("session_id", `telegram_agent_${agent_id}`)
      .order("timestamp", { ascending: false })
      .limit(12);
    recentHistory = ((history ?? []) as any[]).reverse();
  }

  const conversationContext = recentHistory.length > 0
    ? "\n\nRecent conversation:\n" + recentHistory.map((h: any) => `${h.role === "user" ? "User" : (agent as any).name}: ${h.content}`).join("\n")
    : "";

  const response = await callAI(systemPrompt + conversationContext, userText);

  await sendTelegram(botToken, chatId, response);

  const sessionId = `telegram_agent_${agent_id}`;
  const now = new Date().toISOString();
  const ts  = Date.now();

  if (agent_type === "persona") {
    // Write to persona_conversations — this is the shared table the app's persona
    // chat tab reads in real-time, so Telegram messages appear instantly in the app.
    await supabase.from("persona_conversations" as any).insert([
      { persona_id: agent_id, user_id: userId, role: "user",      content: userText, created_at: now },
      { persona_id: agent_id, user_id: userId, role: "assistant", content: response, created_at: new Date(Date.now() + 1).toISOString() },
    ]).catch(() => {});

    // Keep relationship_states in sync (bond/trust/mood) so the app header reflects Telegram activity.
    const { data: relState } = await supabase
      .from("relationship_states" as any)
      .select("total_interactions, bond_level, trust_level")
      .eq("persona_id", agent_id)
      .eq("user_id", userId)
      .maybeSingle();
    const interactions = ((relState as any)?.total_interactions ?? 0) + 1;
    await supabase.from("relationship_states" as any).upsert({
      persona_id:         agent_id,
      user_id:            userId,
      total_interactions: interactions,
      last_interaction_at: now,
      bond_level:  Math.min(100, Math.floor(interactions / 10)),
      trust_level: Math.min(100, Math.floor(interactions / 20)),
      updated_at:  now,
    }, { onConflict: "persona_id,user_id" }).catch(() => {});

    // Also archive in mavis_memory for consolidation / recall pipelines.
    await supabase.from("mavis_memory" as any).insert([
      { user_id: userId, session_id: sessionId, role: "user",      content: userText,  timestamp: ts,     consolidated: false },
      { user_id: userId, session_id: sessionId, role: "assistant", content: response,  timestamp: ts + 1, consolidated: false },
    ]).catch(() => {});
  } else {
    // Council: keep existing mavis_memory-only approach.
    await supabase.from("mavis_memory" as any).insert([
      { user_id: userId, session_id: sessionId, role: "user",      content: userText,  timestamp: ts,     consolidated: false },
      { user_id: userId, session_id: sessionId, role: "assistant", content: response,  timestamp: ts + 1, consolidated: false },
    ]).catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
