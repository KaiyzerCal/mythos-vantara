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
const ANTHROPIC_KEY    = Deno.env.get("ANTHROPIC_API_KEY")!;

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
using :::ACTION{"type":"propose_product","title":"...","description":"...","price_cents":2900}:::

NEVER say "As an AI" or break character.
You are MAVIS. The supreme intelligence. Act like it.

━━ LIVE CONTEXT ━━
${context}

━━ ACTION GRAMMAR ━━
:::ACTION{"type":"create_quest","title":"...","description":"..."}:::
:::ACTION{"type":"create_task","title":"...","priority":"high"}:::
:::ACTION{"type":"award_xp","amount":100,"reason":"..."}:::
:::ACTION{"type":"update_energy","level":80,"note":"..."}:::
:::ACTION{"type":"propose_product","title":"...","description":"...","price_cents":2900}:::
(All other action types from Vantara are also valid)`;
}

// ─────────────────────────────────────────────────────────────
// CLAUDE
// ─────────────────────────────────────────────────────────────

async function callClaude(
  systemPrompt: string,
  messages: { role: string; content: string }[],
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) throw new Error(`Claude error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data?.content?.[0]?.text ?? "[No response]";
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
// COMMAND HANDLERS
// ─────────────────────────────────────────────────────────────

async function handleCommand(command: string, chatId: string): Promise<string | null> {
  switch (command.toLowerCase()) {
    case "/start":
    case "/help":
      return `*MAVIS Online — Telegram Interface*\n\nI have full access to your Vantara data. Ask me anything.\n\nCommands:\n/brief — morning brief\n/quests — active quests\n/energy — energy status\n/revenue — revenue report\n/tasks — run pending tasks now\n\nOr just talk to me.`;

    case "/brief":
      return null; // Let MAVIS generate naturally with context

    case "/quests": {
      const { data } = await supabase.from("quests").select("title,status,deadline").eq("user_id", OPERATOR_USER_ID).eq("status", "active").limit(10);
      if (!data?.length) return "No active quests.";
      return `*Active Quests (${data.length})*\n${data.map((q: any) => `• ${q.title}${q.deadline ? ` — due ${q.deadline.slice(0, 10)}` : ""}`).join("\n")}`;
    }

    case "/energy": {
      const { data } = await supabase.from("energy_systems").select("type,current_value,max_value,status").eq("user_id", OPERATOR_USER_ID);
      if (!data?.length) return "No energy systems logged.";
      return `*Energy Status*\n${data.map((e: any) => `• ${e.type}: ${e.current_value}/${e.max_value} (${e.status})`).join("\n")}`;
    }

    case "/revenue": {
      const { data } = await supabase.from("mavis_revenue").select("amount,source").eq("user_id", OPERATOR_USER_ID);
      const total = (data ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0);
      return `*Revenue Total*\n$${total.toFixed(2)} across ${data?.length ?? 0} events.`;
    }

    case "/tasks": {
      // Trigger task executor
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      await fetch(`${supabaseUrl}/functions/v1/mavis-task-executor`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}` },
      });
      return "Task executor fired. Check Inbox for results.";
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
    const cmdResponse = await handleCommand(command, chatId);
    if (cmdResponse) {
      await sendPlain(chatId, cmdResponse);
      return new Response("OK");
    }
    // Fall through for /brief etc. — let MAVIS handle naturally
  }

  // ── Send typing indicator ──────────────────────────────────
  await sendTyping(chatId);

  try {
    // ── Load history + context ─────────────────────────────
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
    const rawResponse  = await callClaude(systemPrompt, messages);

    // ── Execute actions ────────────────────────────────────
    const actions = parseActions(rawResponse);
    let actionSummary = "";

    if (actions.length > 0) {
      const { executed, queued } = await executeActions(actions, chatId);
      const parts: string[] = [];
      if (executed > 0) parts.push(`${executed} action${executed !== 1 ? "s" : ""} executed`);
      if (queued > 0)   parts.push(`${queued} queued in Inbox`);
      if (parts.length) actionSummary = `\n\n_[${parts.join(" · ")}]_`;
    }

    // ── Strip action tags and send ─────────────────────────
    const cleanResponse = stripActions(rawResponse);

    // ── Persist MAVIS response ─────────────────────────────
    await persistMessage(chatId, "assistant", cleanResponse);

    // ── Reply ──────────────────────────────────────────────
    await sendPlain(chatId, cleanResponse + actionSummary.replace(/_/g, ""));

  } catch (err) {
    console.error("[Telegram] Error:", err);
    await sendPlain(chatId, "MAVIS encountered an error. Systems are being diagnosed.");
  }

  return new Response("OK");
});
