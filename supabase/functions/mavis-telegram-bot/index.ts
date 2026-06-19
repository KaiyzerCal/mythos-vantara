// mavis-telegram-bot — Telegram webhook receiver for mobile MAVIS access.
// Supports text, voice (Whisper STT), photos (vision analysis), and multi-turn memory.
// Serves both Calvin (MAVIS_OPERATOR_MAIN_ID) and Caliyah (MAVIS_OPERATOR_CALIYAH_ID).
//
// Setup (one-time, paste in terminal after deploying):
//   curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
//     -d "url=${SUPABASE_URL}/functions/v1/mavis-telegram-bot" \
//     -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
//     -d "allowed_updates=[\"message\"]"
//
// Required env vars:
//   TELEGRAM_BOT_TOKEN                — from @BotFather
//   TELEGRAM_OPERATOR_CHAT_ID         — Calvin's Telegram chat ID (security gate)
//   TELEGRAM_WEBHOOK_SECRET           — random string, set in setWebhook + Supabase secrets
//   MAVIS_OPERATOR_MAIN_ID            — Supabase user UUID for Calvin
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   ANTHROPIC_API_KEY
// Optional:
//   TELEGRAM_OPERATOR_CALIYAH_CHAT_ID — Caliyah's Telegram chat ID
//   MAVIS_OPERATOR_CALIYAH_ID         — Supabase user UUID for Caliyah
//   OPENAI_API / OPENAI_API_KEY       — enables voice transcription via Whisper

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const BOT_TOKEN      = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const OPERATOR_CHAT  = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";
const CALIYAH_CHAT   = Deno.env.get("TELEGRAM_OPERATOR_CALIYAH_CHAT_ID") ?? "";
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const OPERATOR_UID   = Deno.env.get("MAVIS_OPERATOR_MAIN_ID") ?? "";
const CALIYAH_UID    = Deno.env.get("MAVIS_OPERATOR_CALIYAH_ID") ?? "";
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_KEY  = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_KEY     = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

const HISTORY_LIMIT = 10;

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
    const fileRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`,
      { signal: AbortSignal.timeout(8000) },
    );
    const fileData = await fileRes.json() as Record<string, unknown>;
    const filePath = (fileData.result as any)?.file_path as string | undefined;
    if (!filePath) return null;

    const audioRes = await fetch(
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!audioRes.ok) return null;
    const audioBuffer = await audioRes.arrayBuffer();

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
// PHOTO / IMAGE ANALYSIS
// ─────────────────────────────────────────────────────────────

async function analyzePhoto(
  fileId: string,
  prompt: string,
  uid: string,
): Promise<string | null> {
  if (!BOT_TOKEN) return null;
  try {
    // Resolve file path
    const fileRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`,
      { signal: AbortSignal.timeout(8000) },
    );
    const fileData = await fileRes.json() as Record<string, unknown>;
    const filePath = (fileData.result as any)?.file_path as string | undefined;
    if (!filePath) return null;

    // Download image bytes
    const imgRes = await fetch(
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!imgRes.ok) return null;
    const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
    const base64   = btoa(String.fromCharCode(...imgBytes));
    const ext      = filePath.split(".").pop()?.toLowerCase() ?? "jpg";
    const mimeMap: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
    const mediaType = mimeMap[ext] ?? "image/jpeg";

    // Call mavis-vision-agent
    const visionRes = await fetch(`${SUPABASE_URL}/functions/v1/mavis-vision-agent`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body:    JSON.stringify({ userId: uid, action: "analyze", image: base64, media_type: mediaType, prompt }),
      signal:  AbortSignal.timeout(30000),
    });
    if (!visionRes.ok) return null;
    const visionData = await visionRes.json() as Record<string, unknown>;
    return String(visionData.result ?? visionData.text ?? "").trim() || null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// CONVERSATION MEMORY (chat_conversations + chat_messages)
// ─────────────────────────────────────────────────────────────

type ChatMessage = { role: "user" | "assistant"; content: string };

function sessionTitle(uid: string): string {
  return uid === CALIYAH_UID ? "[Telegram Caliyah] MAVIS Session" : "[Telegram] MAVIS Session";
}

async function getOrCreateSession(uid: string): Promise<string | null> {
  if (!uid) return null;
  const title = sessionTitle(uid);

  const { data: existing } = await sb
    .from("chat_conversations")
    .select("id")
    .eq("user_id", uid)
    .eq("title", title)
    .order("updated_at", { ascending: false })
    .limit(1)
    .single()
    .catch(() => ({ data: null }));

  if ((existing as any)?.id) return (existing as any).id;

  const { data: created } = await sb
    .from("chat_conversations")
    .insert({ user_id: uid, title })
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
    .limit(HISTORY_LIMIT * 2)
    .catch(() => ({ data: null }));

  if (!data) return [];
  return ((data as any[]).reverse() as ChatMessage[]);
}

async function saveExchange(
  conversationId: string,
  uid: string,
  userContent: string,
  assistantContent: string,
): Promise<void> {
  if (!uid) return;
  await sb.from("chat_messages").insert([
    { conversation_id: conversationId, user_id: uid, role: "user",      content: userContent,      mode: "TELEGRAM" },
    { conversation_id: conversationId, user_id: uid, role: "assistant", content: assistantContent, mode: "TELEGRAM" },
  ]).catch(() => null);
}

// ─────────────────────────────────────────────────────────────
// CLAUDE (fallback direct)
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
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: maxTokens, system, messages }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return "";
  const d = await res.json();
  return d?.content?.[0]?.text ?? "";
}

// ─────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────

async function callFunction(name: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(45000),
  });
}

async function queueTask(
  uid: string,
  type: string,
  description: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const { data } = await sb
    .from("mavis_tasks")
    .insert({ user_id: uid, type, description, payload, status: "pending" })
    .select("id")
    .single()
    .catch(() => ({ data: null }));
  return (data as any)?.id ?? null;
}

// ─────────────────────────────────────────────────────────────
// INTENT CLASSIFICATION
// ─────────────────────────────────────────────────────────────

type Intent = "help" | "quests" | "revenue" | "tasks" | "content_machine" | "speak" | "chat";
interface Classified { intent: Intent; params: Record<string, string>; }

function classify(text: string): Classified {
  const lower = text.toLowerCase().trim();
  if (/^\/?(help|commands?)$/i.test(lower))    return { intent: "help",    params: {} };
  if (/^\/?(quests?|missions?)$/i.test(lower)) return { intent: "quests",  params: {} };
  if (/^\/?(revenue|money|earnings?|income)$/i.test(lower)) return { intent: "revenue", params: {} };
  if (/^\/?(tasks?|queue|pending)$/i.test(lower)) return { intent: "tasks", params: {} };
  if (/^\/?(content|nora content|video content|post content)\s+(.+)$/i.test(lower)) {
    const topic = text.replace(/^\/?(content|nora content|video content|post content)\s+/i, "").trim();
    return { intent: "content_machine", params: { topic } };
  }
  const speakMatch = text.match(/^\/?(speak|tts|say)\s*(.*)?$/i);
  if (speakMatch) return { intent: "speak", params: { args: (speakMatch[2] ?? "").trim() } };
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
    `*MAVIS — Mobile Interface*\n\n` +
    `Just talk to MAVIS naturally. Examples:\n` +
    `• _"Generate an image of a dark forest at dawn"_\n` +
    `• _"Tweet about AI automation for founders"_\n` +
    `• _"Schedule a call with Jordan tomorrow at 2pm and email her"_\n` +
    `• _"Create a quest called Master the morning routine"_\n` +
    `• _"What should I focus on this week?"_\n` +
    `• _"Give me my daily brief"_\n\n` +
    `*Fast commands:*\n` +
    `⚔️ \`quests\` — active quests\n` +
    `💰 \`revenue\` — earnings overview\n` +
    `📌 \`tasks\` — pending task queue\n` +
    `🎬 \`content <topic>\` — Nora content pipeline\n\n` +
    `📸 _Send a photo to analyze it_\n` +
    voiceLine,
  );
}

async function handleContentMachine(chatId: string | number, uid: string, topic: string) {
  const id = await queueTask(uid, "nora_content_machine", `Nora content: ${topic}`, {
    topic,
    platforms: ["twitter", "linkedin", "tiktok"],
    triggered_by: "telegram",
  });
  if (id) {
    await send(chatId,
      `🎬 Content pipeline queued: _${topic}_\n\n` +
      `Phase 1: research → script → avatar video\n` +
      `Phase 2: post to Twitter, LinkedIn, TikTok\n\n` +
      `_Needs: FAL_API_KEY, ELEVENLABS_API_KEY, NORA_AVATAR_IMAGE_URL_`,
    );
  } else {
    await send(chatId, `⚠️ Failed to queue content pipeline.`);
  }
}

// ─────────────────────────────────────────────────────────────
// TRANSLATE + SPEAK  (translate via Claude → TTS via OpenAI → send audio)
// Usage: /speak [lang] text   e.g. /speak es Hello world
// ─────────────────────────────────────────────────────────────

const LANG_NAMES: Record<string, string> = {
  en: "English", es: "Spanish", fr: "French", de: "German", ja: "Japanese",
  ko: "Korean", zh: "Mandarin Chinese", pt: "Portuguese", it: "Italian",
  ar: "Arabic", ru: "Russian", hi: "Hindi", nl: "Dutch", sv: "Swedish",
  pl: "Polish", tr: "Turkish", vi: "Vietnamese", th: "Thai",
};

async function handleSpeak(chatId: string | number, uid: string, args: string) {
  if (!args) {
    await send(chatId,
      `🔊 *Translate & Speak*\n\nUsage: \`/speak [lang] text\`\n\n` +
      `Examples:\n• \`/speak es Hello world\` → Spanish audio\n` +
      `• \`/speak ja Good morning\` → Japanese audio\n` +
      `• \`/speak de How are you?\` → German audio\n\n` +
      `Omit the language code to hear it in English.`
    );
    return;
  }

  const parts = args.split(/\s+/);
  let targetLang = "en";
  let textToSpeak = args;

  // If first word is a 2-5 char language code, use it
  if (parts.length > 1 && /^[a-z]{2,5}(-[A-Z]{2})?$/.test(parts[0])) {
    targetLang = parts[0].toLowerCase();
    textToSpeak = parts.slice(1).join(" ");
  }

  await typing(chatId);

  // 1. Translate via Claude Haiku
  let translated = textToSpeak;
  if (ANTHROPIC_KEY) {
    const langName = LANG_NAMES[targetLang] ?? targetLang;
    const tRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        system: `Translate the user's text into ${langName}. Return ONLY the translated text, nothing else — no quotes, no explanation.`,
        messages: [{ role: "user", content: textToSpeak }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const tData = await tRes.json().catch(() => ({}));
    translated = (tData as any).content?.[0]?.text?.trim() ?? textToSpeak;
  }

  if (!OPENAI_KEY) {
    // Fallback: text-only translation
    await send(chatId, `🌐 *${targetLang.toUpperCase()} translation:*\n\n${translated}\n\n_Set OPENAI\\_API\\_KEY to enable audio._`);
    return;
  }

  // 2. TTS via OpenAI (tts-1, nova voice)
  const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "tts-1", input: translated, voice: "nova", response_format: "mp3" }),
    signal: AbortSignal.timeout(30000),
  });

  if (!ttsRes.ok) {
    await send(chatId, `🌐 *${targetLang.toUpperCase()} translation:*\n\n${translated}`);
    return;
  }

  // 3. Send audio via Telegram sendAudio
  const audioBytes = await ttsRes.arrayBuffer();
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("audio", new Blob([audioBytes], { type: "audio/mpeg" }), `mavis_${targetLang}.mp3`);
  form.append("caption", `🌐 *${targetLang.toUpperCase()}:* ${translated.slice(0, 900)}`);
  form.append("parse_mode", "Markdown");

  const sendRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendAudio`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30000),
  });

  if (!sendRes.ok) {
    await send(chatId, `🌐 *${targetLang.toUpperCase()} translation:*\n\n${translated}`);
  }
}

async function handleQuests(chatId: string | number, uid: string) {
  const { data: quests } = await sb
    .from("quests")
    .select("title, status, type, xp_reward")
    .eq("user_id", uid)
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

async function handleRevenue(chatId: string | number, uid: string) {
  const { data: rows } = await sb
    .from("mavis_revenue")
    .select("amount, source, created_at")
    .eq("user_id", uid)
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

async function handleTasks(chatId: string | number, uid: string) {
  const { data: tasks } = await sb
    .from("mavis_tasks")
    .select("type, description, status, created_at")
    .eq("user_id", uid)
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(10);

  if (!tasks || (tasks as any[]).length === 0) {
    await send(chatId, `📌 No pending tasks.`);
    return;
  }

  const lines = (tasks as any[]).map((t) =>
    `• [${t.status}] *${t.type}* — ${(t.description ?? "").slice(0, 60)}`,
  );
  await send(chatId, `📌 *Queue (${lines.length})*\n\n${lines.join("\n")}`);
}

async function handleChat(
  chatId: string | number,
  uid: string,
  text: string,
  history: ChatMessage[],
  sessionId: string | null,
) {
  await typing(chatId);

  try {
    const messages: ChatMessage[] = [
      ...history,
      { role: "user", content: text },
    ];

    const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-chat`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "X-Mavis-User-Id": uid,
      },
      body: JSON.stringify({
        messages,
        mode:           "PRIME",
        conversationId: sessionId ?? undefined,
        channel:        "telegram",
        stream:         false,
      }),
      signal: AbortSignal.timeout(55000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>;
      await send(chatId, `⚠️ MAVIS error: ${String((err as any).error ?? res.status)}`);
      return;
    }

    const data    = await res.json() as Record<string, unknown>;
    const content = String(data.content ?? "").trim();
    const visible = content.replace(/:::ACTION\{[\s\S]*?\}:::/g, "").trim();

    if (!visible) {
      await send(chatId, "⚠️ No response from MAVIS.");
      return;
    }

    await send(chatId, visible);

    if (sessionId) await saveExchange(sessionId, uid, text, visible);

    const imageUrl = String(data.imageUrl ?? "");
    if (imageUrl.startsWith("http")) await sendPhoto(chatId, imageUrl);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("timeout") || msg.includes("network")) {
      const reply = await callClaude(
        "You are MAVIS — Calvin's personal AI operating system. Sharp, direct, strategic. Via Telegram.",
        [...history, { role: "user", content: text }],
        600,
      );
      await send(chatId, reply || "⚠️ MAVIS is unreachable right now.");
      if (reply && sessionId) await saveExchange(sessionId, uid, text, reply);
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

    const chatId = String((message.chat as any)?.id ?? "");
    if (!chatId) return;

    // Security gate — only Calvin and Caliyah
    const isCalvin  = OPERATOR_CHAT  && chatId === String(OPERATOR_CHAT);
    const isCaliyah = CALIYAH_CHAT   && chatId === String(CALIYAH_CHAT);

    if (!isCalvin && !isCaliyah) {
      await tg("sendMessage", { chat_id: chatId, text: "⛔ Unauthorized. This MAVIS instance is operator-locked." });
      return;
    }

    const uid = isCaliyah ? CALIYAH_UID : OPERATOR_UID;

    if (!uid) {
      await send(chatId, isCaliyah
        ? "⚠️ MAVIS_OPERATOR_CALIYAH_ID not configured."
        : "⚠️ MAVIS_OPERATOR_MAIN_ID not configured."
      );
      return;
    }

    // ── Resolve input ─────────────────────────────────────────

    let text    = String((message.text ?? message.caption) ?? "").trim();
    let wasVoice  = false;
    let wasPhoto  = false;
    let photoFileId: string | null = null;

    // Voice / audio
    const voice = (message.voice ?? message.audio) as Record<string, unknown> | undefined;
    if (!text && voice?.file_id) {
      await typing(chatId);
      const transcription = await transcribeVoice(String(voice.file_id));
      if (transcription) {
        text     = transcription;
        wasVoice = true;
      } else {
        await send(chatId, OPENAI_KEY
          ? "⚠️ Couldn't transcribe audio. Try again or type your message."
          : "⚠️ Voice not supported — set OPENAI_API_KEY in Supabase secrets to enable transcription."
        );
        return;
      }
    }

    // Photo / image — handled after voice so caption takes precedence as prompt
    const photos = (message.photo as any[]) ?? null;
    if (photos?.length) {
      photoFileId = String(photos[photos.length - 1].file_id ?? "");
      wasPhoto    = true;
    }

    // If photo with no text prompt, reply with vision analysis directly
    if (wasPhoto && photoFileId) {
      await typing(chatId);
      const prompt   = text || "Describe what you see in this image in detail.";
      const analysis = await analyzePhoto(photoFileId, prompt, uid);
      if (analysis) {
        await send(chatId, `📸 ${analysis}`);
      } else {
        await send(chatId, "⚠️ Could not analyze image. Ensure ANTHROPIC_API_KEY is set.");
      }
      return;
    }

    if (!text) {
      // Unsupported message type (sticker, location, etc.)
      await send(chatId, "⚠️ Unable to process your message. Send text, voice, or a photo.");
      return;
    }

    // ── Session + history ──────────────────────────────────────

    const sessionId = await getOrCreateSession(uid);
    const history   = sessionId ? await loadHistory(sessionId) : [];

    if (wasVoice) {
      await send(chatId, `🎤 _"${text.slice(0, 120)}${text.length > 120 ? "…" : ""}"_`);
    }

    // ── Classify + dispatch ────────────────────────────────────

    try {
      const { intent, params } = classify(text);
      switch (intent) {
        case "help":            await handleHelp(chatId); break;
        case "quests":          await handleQuests(chatId, uid); break;
        case "revenue":         await handleRevenue(chatId, uid); break;
        case "tasks":           await handleTasks(chatId, uid); break;
        case "speak":           await handleSpeak(chatId, uid, params.args ?? ""); break;
        case "content_machine": await handleContentMachine(chatId, uid, params.topic ?? text); break;
        default:                await handleChat(chatId, uid, text, history, sessionId); break;
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
