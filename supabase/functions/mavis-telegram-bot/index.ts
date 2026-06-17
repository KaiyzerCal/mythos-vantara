// mavis-telegram-bot — Telegram webhook receiver for mobile MAVIS access.
// Supports text messages, voice memos (Whisper STT), and multi-turn conversation memory.
//
// Setup (one-time, paste in terminal after deploying):
//   curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
//     -d "url=${SUPABASE_URL}/functions/v1/mavis-telegram-bot" \
//     -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
//     -d "allowed_updates=[\"message\"]"
//
// Required env vars:
//   TELEGRAM_BOT_TOKEN          — from @BotFather
//   TELEGRAM_OPERATOR_CHAT_ID   — your Telegram chat ID (security gate)
//   TELEGRAM_WEBHOOK_SECRET     — any random string, set in setWebhook + Supabase secrets
//   MAVIS_OPERATOR_MAIN_ID      — Supabase user UUID for Calvin (task ownership)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   ANTHROPIC_API_KEY
// Optional:
//   OPENAI_API / OPENAI_API_KEY — enables voice message transcription via Whisper

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const BOT_TOKEN      = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const OPERATOR_CHAT  = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const OPERATOR_UID   = Deno.env.get("MAVIS_OPERATOR_MAIN_ID") ?? "";
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_KEY  = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_KEY     = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

const HISTORY_LIMIT = 10; // message pairs to retain per session
const TELEGRAM_SESSION_TITLE = "[Telegram] MAVIS Session";

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// ─────────────────────────────────────────────────────────────
// TELEGRAM API
// ─────────────────────────────────────────────────────────────

async function tg(method: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  return res.json().catch(() => ({}));
}

async function send(chatId: string | number, text: string, extra: Record<string, unknown> = {}) {
  return tg("sendMessage", { chat_id: chatId, text: text.slice(0, 4096), parse_mode: "Markdown", ...extra });
}

async function sendPhoto(chatId: string | number, photoUrl: string, caption?: string) {
  return tg("sendPhoto", { chat_id: chatId, photo: photoUrl, caption: caption?.slice(0, 1024) ?? "" });
}

async function typing(chatId: string | number) {
  return tg("sendChatAction", { chat_id: chatId, action: "typing" });
}

// ─────────────────────────────────────────────────────────────
// VOICE TRANSCRIPTION (OpenAI Whisper)
// ─────────────────────────────────────────────────────────────

async function transcribeVoice(fileId: string): Promise<string | null> {
  if (!OPENAI_KEY || !BOT_TOKEN) return null;

  try {
    // Step 1: get the file path from Telegram
    const fileRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const fileData = await fileRes.json() as Record<string, unknown>;
    const filePath = (fileData.result as any)?.file_path as string | undefined;
    if (!filePath) return null;

    // Step 2: download the audio binary
    const audioRes = await fetch(
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (!audioRes.ok) return null;
    const audioBuffer = await audioRes.arrayBuffer();

    // Step 3: transcribe via OpenAI Whisper
    const form = new FormData();
    const ext = filePath.split(".").pop() ?? "ogg";
    const mimeType = ext === "mp3" ? "audio/mpeg" : ext === "m4a" ? "audio/mp4" : "audio/ogg";
    form.append("file", new Blob([audioBuffer], { type: mimeType }), `voice.${ext}`);
    form.append("model", "whisper-1");

    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_KEY}` },
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    if (!whisperRes.ok) return null;

    const whisperData = await whisperRes.json() as Record<string, unknown>;
    return String(whisperData.text ?? "").trim() || null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// CONVERSATION MEMORY (chat_conversations + chat_messages)
// ─────────────────────────────────────────────────────────────

type ChatMessage = { role: "user" | "assistant"; content: string };

async function getOrCreateSession(): Promise<string | null> {
  if (!OPERATOR_UID) return null;

  // Look for an existing telegram session conversation
  const { data: existing } = await sb
    .from("chat_conversations")
    .select("id")
    .eq("user_id", OPERATOR_UID)
    .eq("title", TELEGRAM_SESSION_TITLE)
    .order("updated_at", { ascending: false })
    .limit(1)
    .single()
    .catch(() => ({ data: null }));

  if ((existing as any)?.id) return (existing as any).id;

  // Create one
  const { data: created } = await sb
    .from("chat_conversations")
    .insert({ user_id: OPERATOR_UID, title: TELEGRAM_SESSION_TITLE })
    .select("id")
    .single()
    .catch(() => ({ data: null }));

  return (created as any)?.id ?? null;
}

async function loadHistory(conversationId: string): Promise<ChatMessage[]> {
  const { data } = await sb
    .from("chat_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT * 2) // fetch more then reverse
    .catch(() => ({ data: null }));

  if (!data) return [];
  return ((data as any[]).reverse() as ChatMessage[]);
}

async function saveExchange(
  conversationId: string,
  userContent: string,
  assistantContent: string,
): Promise<void> {
  if (!OPERATOR_UID) return;
  await sb.from("chat_messages").insert([
    { conversation_id: conversationId, user_id: OPERATOR_UID, role: "user",      content: userContent,      mode: "TELEGRAM" },
    { conversation_id: conversationId, user_id: OPERATOR_UID, role: "assistant", content: assistantContent, mode: "TELEGRAM" },
  ]).catch(() => null);
}

// ─────────────────────────────────────────────────────────────
// CLAUDE
// ─────────────────────────────────────────────────────────────

async function callClaude(
  system: string,
  messages: ChatMessage[],
  maxTokens = 800,
): Promise<string> {
  if (!ANTHROPIC_KEY) return "(ANTHROPIC_API_KEY not set)";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system,
      messages,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return "";
  const d = await res.json();
  return d?.content?.[0]?.text ?? "";
}

// Single-turn shorthand (no history needed — used for classification + task confirmations)
async function callClaudeOnce(system: string, user: string, maxTokens = 600): Promise<string> {
  return callClaude(system, [{ role: "user", content: user }], maxTokens);
}

// ─────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────

async function callFunction(name: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
}

async function queueTask(
  type: string,
  description: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const { data } = await sb
    .from("mavis_tasks")
    .insert({ user_id: OPERATOR_UID, type, description, payload, status: "pending" })
    .select("id")
    .single()
    .catch(() => ({ data: null }));
  return (data as any)?.id ?? null;
}

// ─────────────────────────────────────────────────────────────
// INTENT CLASSIFICATION
// ─────────────────────────────────────────────────────────────

type Intent =
  | "help"
  | "image"
  | "tweet"
  | "content_machine"
  | "daily_brief"
  | "goal"
  | "quests"
  | "revenue"
  | "tasks"
  | "chat";

interface Classified {
  intent: Intent;
  params: Record<string, string>;
}

async function classify(text: string, history: ChatMessage[]): Promise<Classified> {
  const lower = text.toLowerCase().trim();

  // Hard-coded shortcuts for speed (no LLM needed)
  if (/^\/?(help|commands?)$/i.test(lower)) return { intent: "help", params: {} };
  if (/^\/?(brief|status|morning|daily)$/i.test(lower)) return { intent: "daily_brief", params: {} };
  if (/^\/?(quests?|missions?)$/i.test(lower)) return { intent: "quests", params: {} };
  if (/^\/?(revenue|money|earnings?|income)$/i.test(lower)) return { intent: "revenue", params: {} };
  if (/^\/?(tasks?|queue|pending)$/i.test(lower)) return { intent: "tasks", params: {} };

  if (/^\/?(image|img|generate|gen|draw|create image)\s+(.+)$/i.test(lower)) {
    const topic = text.replace(/^\/?(image|img|generate|gen|draw|create image)\s+/i, "").trim();
    return { intent: "image", params: { topic } };
  }
  if (/^\/?(tweet|post to twitter|twitter)\s+(.+)$/i.test(lower)) {
    const content = text.replace(/^\/?(tweet|post to twitter|twitter)\s+/i, "").trim();
    return { intent: "tweet", params: { content } };
  }
  if (/^\/?(content|nora content|video content|post content)\s+(.+)$/i.test(lower)) {
    const topic = text.replace(/^\/?(content|nora content|video content|post content)\s+/i, "").trim();
    return { intent: "content_machine", params: { topic } };
  }
  if (/^\/?(goal|achieve|accomplish|work on)\s+(.+)$/i.test(lower)) {
    const objective = text.replace(/^\/?(goal|achieve|accomplish|work on)\s+/i, "").trim();
    return { intent: "goal", params: { objective } };
  }

  // Build recent context snippet to help classify follow-ups ("do that for twitter too")
  const contextSnippet = history.slice(-4)
    .map((m) => `${m.role === "user" ? "You" : "MAVIS"}: ${m.content.slice(0, 120)}`)
    .join("\n");

  const raw = await callClaudeOnce(
    `You classify messages sent to an AI operating system (MAVIS) via Telegram.
Return ONLY a JSON object.

Intents:
- "image"           → generate an image. Extract "topic".
- "tweet"           → post as Nora Vale on Twitter. Extract "content".
- "content_machine" → full avatar video + multi-platform post. Extract "topic".
- "daily_brief"     → daily status briefing.
- "goal"            → pursue a goal autonomously. Extract "objective".
- "quests"          → show active quests.
- "revenue"         → earnings overview.
- "tasks"           → show pending task queue.
- "help"            → list what MAVIS can do.
- "chat"            → conversation, question, or follow-up.

${contextSnippet ? `Recent conversation:\n${contextSnippet}\n` : ""}
Example: {"intent":"image","params":{"topic":"cyberpunk city at dusk"}}`,
    `Message: "${text}"`,
    300,
  );

  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as Classified;
  } catch { /* fall through */ }

  return { intent: "chat", params: {} };
}

// ─────────────────────────────────────────────────────────────
// INTENT HANDLERS
// ─────────────────────────────────────────────────────────────

async function handleHelp(chatId: string | number) {
  const voiceLine = OPENAI_KEY
    ? `🎤 _Voice memos supported — just send a voice message_`
    : `🎤 _Voice: set OPENAI_API_KEY to enable_`;

  await send(chatId,
    `*MAVIS — Mobile Commands*\n\n` +
    `🖼 \`image <topic>\` — generate an image\n` +
    `🐦 \`tweet <text>\` — post as Nora Vale on Twitter\n` +
    `🎬 \`content <topic>\` — avatar video + multi-platform post\n` +
    `🎯 \`goal <objective>\` — start an autonomous goal\n` +
    `📋 \`brief\` — daily status briefing\n` +
    `⚔️ \`quests\` — active quests\n` +
    `💰 \`revenue\` — earnings overview\n` +
    `📌 \`tasks\` — pending task queue\n` +
    `💬 anything else — chat with MAVIS (remembers context)\n\n` +
    voiceLine
  );
}

async function handleImage(chatId: string | number, topic: string) {
  await send(chatId, `🖼 Generating: _${topic}_…`);
  await typing(chatId);

  const res = await callFunction("mavis-actions", {
    actions: [{ type: "generate_image", params: { prompt: topic, aspect_ratio: "1:1", save_to_vault: true } }],
    userId: OPERATOR_UID,
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  const results = (data as any)?.results ?? [];
  const imageUrl = (results[0] as any)?.imageUrl ?? (results[0] as any)?.result?.imageUrl ?? "";

  if (imageUrl && imageUrl.startsWith("http")) {
    await sendPhoto(chatId, imageUrl, `📸 ${topic}`);
  } else if (imageUrl.startsWith("data:image")) {
    await send(chatId, `✅ Image generated and saved to Vault.`);
  } else {
    await send(chatId, `⚠️ Image generation failed. Check GEMINI_API_KEY in Supabase secrets.`);
  }
}

async function handleTweet(chatId: string | number, content: string) {
  const id = await queueTask("nora_tweet", content, { content });
  if (id) {
    await send(chatId, `🐦 Tweet queued — posts within 15 min.\n\n_"${content.slice(0, 100)}${content.length > 100 ? "…" : ""}"_`);
  } else {
    await send(chatId, `⚠️ Failed to queue tweet.`);
  }
}

async function handleContentMachine(chatId: string | number, topic: string) {
  const id = await queueTask("nora_content_machine", `Nora content: ${topic}`, {
    topic,
    platforms: ["twitter", "linkedin", "tiktok"],
    triggered_by: "telegram",
  });
  if (id) {
    await send(chatId,
      `🎬 Content pipeline queued: _${topic}_\n\n` +
      `Phase 1: research → script → avatar video\n` +
      `Phase 2: post to Twitter, LinkedIn, TikTok\n\n` +
      `_Needs: FAL_API_KEY, ELEVENLABS_API_KEY, NORA_AVATAR_IMAGE_URL_`
    );
  } else {
    await send(chatId, `⚠️ Failed to queue content pipeline.`);
  }
}

async function handleDailyBrief(chatId: string | number) {
  const id = await queueTask("daily_brief", "Daily brief (Telegram)", {});
  if (id) {
    await send(chatId, `📋 Daily brief queued — check MAVIS or wait for the next executor cycle.`);
  } else {
    await send(chatId, `⚠️ Failed to queue brief.`);
  }
}

async function handleGoal(chatId: string | number, objective: string) {
  const id = await queueTask("goal", objective, { objective, context: "triggered via Telegram" });
  if (id) {
    await send(chatId,
      `🎯 Goal queued: _${objective}_\n\n` +
      `MAVIS will plan and execute autonomously. Open the Task Dashboard to track progress.`
    );
  } else {
    await send(chatId, `⚠️ Failed to queue goal.`);
  }
}

async function handleQuests(chatId: string | number) {
  const { data: quests } = await sb
    .from("quests")
    .select("title, status, type, xp_reward")
    .eq("user_id", OPERATOR_UID)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(10);

  if (!quests || (quests as any[]).length === 0) {
    await send(chatId, `⚔️ No active quests.`);
    return;
  }

  const lines = (quests as any[]).map((q) => `• *${q.title}* [${q.type}] +${q.xp_reward ?? 0}XP`);
  await send(chatId, `⚔️ *Active Quests (${lines.length})*\n\n${lines.join("\n")}`);
}

async function handleRevenue(chatId: string | number) {
  const { data: rows } = await sb
    .from("mavis_revenue")
    .select("amount, source, created_at")
    .eq("user_id", OPERATOR_UID)
    .order("created_at", { ascending: false })
    .limit(20);

  if (!rows || (rows as any[]).length === 0) {
    await send(chatId, `💰 No revenue recorded yet.`);
    return;
  }

  const total = (rows as any[]).reduce((s: number, r: any) => s + Number(r.amount), 0);
  const bySource = (rows as any[]).reduce((acc: Record<string, number>, r: any) => {
    acc[r.source] = (acc[r.source] ?? 0) + Number(r.amount);
    return acc;
  }, {});

  const breakdown = Object.entries(bySource)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .map(([src, amt]) => `• ${src}: $${(amt as number).toFixed(2)}`)
    .join("\n");

  await send(chatId, `💰 *Revenue*\n\nTotal: *$${total.toFixed(2)}*\n\n${breakdown}`);
}

async function handleTasks(chatId: string | number) {
  const { data: tasks } = await sb
    .from("mavis_tasks")
    .select("type, description, status, created_at")
    .eq("user_id", OPERATOR_UID)
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(10);

  if (!tasks || (tasks as any[]).length === 0) {
    await send(chatId, `📌 No pending tasks.`);
    return;
  }

  const lines = (tasks as any[]).map((t) =>
    `• [${t.status}] *${t.type}* — ${(t.description ?? "").slice(0, 60)}`
  );
  await send(chatId, `📌 *Queue (${lines.length})*\n\n${lines.join("\n")}`);
}

async function handleChat(
  chatId: string | number,
  text: string,
  history: ChatMessage[],
  sessionId: string | null,
) {
  await typing(chatId);

  // Route through mavis-chat for the full agentic loop (action dispatch,
  // standing orders, all app context). History is passed so it has full
  // conversation continuity. sessionId is passed so mavis-chat's own
  // memory persistence uses the same conversation record.
  try {
    const messages: ChatMessage[] = [
      ...history,
      { role: "user", content: text },
    ];

    const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "X-Mavis-User-Id": OPERATOR_UID,
      },
      body: JSON.stringify({
        messages,
        mode: "PRIME",
        conversationId: sessionId ?? undefined,
        stream: false,
      }),
      signal: AbortSignal.timeout(55000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>;
      await send(chatId, `⚠️ MAVIS error: ${String((err as any).error ?? res.status)}`);
      return;
    }

    const data = await res.json() as Record<string, unknown>;
    const content = String(data.content ?? "").trim();

    // Strip :::ACTION{...}::: tags — mavis-chat already dispatched them
    const visible = content.replace(/:::ACTION\{[\s\S]*?\}:::/g, "").trim();

    if (!visible) {
      await send(chatId, "⚠️ No response from MAVIS.");
      return;
    }

    await send(chatId, visible);

    // Save to Telegram session history (mavis-chat also saves to mavis_memory,
    // but we persist to chat_messages for the Telegram session window)
    if (sessionId) {
      await saveExchange(sessionId, text, visible);
    }

    // If mavis-chat generated an image, send it
    const imageUrl = String(data.imageUrl ?? "");
    if (imageUrl.startsWith("http")) {
      await sendPhoto(chatId, imageUrl);
    }
  } catch (err) {
    // Fall back to direct Claude if mavis-chat is unreachable
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("timeout") || msg.includes("network")) {
      const reply = await callClaude(
        "You are MAVIS — Calvin's personal AI operating system. Sharp, direct, strategic. Via Telegram.",
        [...history, { role: "user", content: text }],
        600,
      );
      await send(chatId, reply || "⚠️ MAVIS is unreachable right now.");
      if (reply && sessionId) await saveExchange(sessionId, text, reply);
    } else {
      await send(chatId, `⚠️ Error: ${msg.slice(0, 200)}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  // Verify Telegram webhook secret
  const secret = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update: Record<string, unknown>;
  try {
    update = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const process = async () => {
    const message = (update.message ?? update.edited_message) as Record<string, unknown> | undefined;
    if (!message) return;

    const chatId = (message.chat as any)?.id;
    if (!chatId) return;

    // Security gate — only the operator
    if (String(chatId) !== String(OPERATOR_CHAT)) {
      await tg("sendMessage", { chat_id: chatId, text: "⛔ Unauthorized. This MAVIS instance is operator-locked." });
      return;
    }

    if (!OPERATOR_UID) {
      await send(chatId, "⚠️ MAVIS_OPERATOR_MAIN_ID not configured.");
      return;
    }

    // ── Resolve input text ─────────────────────────────────────────────────────

    let text = String((message.text ?? message.caption) ?? "").trim();
    let wasVoice = false;

    const voice = (message.voice ?? message.audio) as Record<string, unknown> | undefined;
    if (!text && voice?.file_id) {
      await typing(chatId);
      const transcription = await transcribeVoice(String(voice.file_id));
      if (transcription) {
        text = transcription;
        wasVoice = true;
      } else {
        await send(chatId, OPENAI_KEY
          ? "⚠️ Couldn't transcribe audio. Try again or type your message."
          : "⚠️ Voice not supported — set OPENAI_API_KEY in Supabase secrets to enable transcription."
        );
        return;
      }
    }

    if (!text) return;

    // ── Load conversation history ──────────────────────────────────────────────

    const sessionId = await getOrCreateSession();
    const history = sessionId ? await loadHistory(sessionId) : [];

    if (wasVoice) {
      await send(chatId, `🎤 _"${text.slice(0, 120)}${text.length > 120 ? "…" : ""}"_`);
    }

    // ── Classify + dispatch ───────────────────────────────────────────────────

    try {
      const { intent, params } = await classify(text, history);

      switch (intent) {
        case "help":            await handleHelp(chatId); break;
        case "image":           await handleImage(chatId, params.topic ?? text); break;
        case "tweet":           await handleTweet(chatId, params.content ?? text); break;
        case "content_machine": await handleContentMachine(chatId, params.topic ?? text); break;
        case "daily_brief":     await handleDailyBrief(chatId); break;
        case "goal":            await handleGoal(chatId, params.objective ?? text); break;
        case "quests":          await handleQuests(chatId); break;
        case "revenue":         await handleRevenue(chatId); break;
        case "tasks":           await handleTasks(chatId); break;
        default:                await handleChat(chatId, text, history, sessionId); break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await send(chatId, `⚠️ Error: ${msg.slice(0, 200)}`);
    }
  };

  // Return 200 to Telegram immediately, process async
  if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
    (globalThis as any).EdgeRuntime.waitUntil(process());
  } else {
    process();
  }

  return new Response("ok", { status: 200 });
});
