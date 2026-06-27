// mavis-telegram-bot — Telegram webhook receiver for mobile MAVIS access.
// Supports text, voice (Whisper STT), photos (vision analysis), and multi-turn memory.
// Serves both Calvin (MAVIS_OPERATOR_MAIN_ID) and Caliyah (MAVIS_OPERATOR_CALIYAH_ID).
//
// Setup (one-time, paste in terminal after deploying):
//   curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
//     -d "url=${SUPABASE_URL}/functions/v1/mavis-telegram-bot" \
//     -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
//     -d "allowed_updates=[\"message\",\"callback_query\"]"
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
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data as any)?.ok === false) {
      console.warn("[telegram-bot] Telegram API call failed", method, res.status, JSON.stringify(data).slice(0, 500));
    }
    return data;
  } catch (err) {
    console.error("[telegram-bot] Telegram API call error", method, err instanceof Error ? err.message : String(err));
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Convert Claude/CommonMark markdown to Telegram Markdown v1 format.
// Telegram uses *single asterisks* for bold; Claude outputs **double asterisks**.
function toTelegramMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/gs, "*$1*")   // **bold** → *bold*
    .replace(/__(.+?)__/gs, "_$1_")         // __italic__ → _italic_
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*"); // ## Heading → *Heading*
}

async function send(chatId: string | number, text: string, extra: Record<string, unknown> = {}) {
  const formatted = toTelegramMarkdown(text);
  const result = await tg("sendMessage", { chat_id: chatId, text: formatted.slice(0, 4096), parse_mode: "Markdown", ...extra }) as Record<string, unknown>;

  // Telegram Markdown is brittle; if formatting rejects a MAVIS response,
  // retry as plain text so the operator still gets an answer.
  if (result?.ok === false) {
    const { parse_mode: _parseMode, ...plainExtra } = extra;
    return tg("sendMessage", { chat_id: chatId, text: text.slice(0, 4096), ...plainExtra });
  }

  return result;
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
// FILE / DOCUMENT DOWNLOAD
// ─────────────────────────────────────────────────────────────

const TEXT_EXTENSIONS = new Set([
  "txt","md","markdown","csv","json","jsonl","ts","tsx","js","jsx","mjs","cjs",
  "py","html","htm","xml","yaml","yml","toml","ini","env","sh","bash","sql",
  "log","css","scss","sass","rs","go","java","c","cpp","h","hpp","rb","php",
  "swift","kt","dart","r","lua","pl","ex","exs","vue","svelte","astro",
]);
const IMAGE_EXTENSIONS = new Set(["jpg","jpeg","png","webp","gif","bmp","tiff","heic"]);
const PDF_EXTENSIONS   = new Set(["pdf"]);

interface FileResult { text?: string; isImage?: boolean; isPdf?: boolean; pdfBase64?: string; mediaType?: string; fileName?: string; error?: string; }

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function downloadFileContent(fileId: string, fileName?: string): Promise<FileResult> {
  try {
    const fileRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    const fileData = await fileRes.json() as Record<string, unknown>;
    const filePath = (fileData.result as any)?.file_path as string | undefined;
    if (!filePath) return { error: "Telegram couldn't resolve the file path — try re-sending the file." };
    const ext = (filePath.split(".").pop() ?? fileName?.split(".").pop() ?? "").toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) return { isImage: true };
    const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
    const dlRes = await fetch(downloadUrl, { signal: AbortSignal.timeout(25_000) });
    if (!dlRes.ok) return { error: `File download failed (HTTP ${dlRes.status}).` };
    const buf = new Uint8Array(await dlRes.arrayBuffer());
    if (PDF_EXTENSIONS.has(ext)) {
      return { isPdf: true, pdfBase64: bytesToBase64(buf), mediaType: "application/pdf", fileName };
    }
    // Detect binary by sampling first 2KB; route binaries to Claude as PDF (best-effort).
    let nonPrintable = 0;
    const sample = buf.subarray(0, Math.min(buf.length, 2048));
    for (const b of sample) {
      if (b === 0 || b < 9 || (b > 13 && b < 32)) nonPrintable++;
    }
    if (sample.length > 0 && nonPrintable / sample.length > 0.1) {
      return { isPdf: true, pdfBase64: bytesToBase64(buf), mediaType: "application/pdf", fileName };
    }
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    const MAX = 18_000;
    const truncated = raw.length > MAX;
    return { text: raw.slice(0, MAX) + (truncated ? "\n\n[...truncated]" : "") };
  } catch (err) {
    return { error: `File error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// Analyze a PDF or binary doc via Claude's document block (base64 source — keeps bot token private).
async function extractDocWithClaude(base64: string, mediaType: string, prompt: string): Promise<string | null> {
  if (!ANTHROPIC_KEY) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: prompt || "Read this document and provide a concise, useful summary of its key points." },
          ],
        }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      console.error("[telegram-bot] Claude doc extract failed:", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    return (data.content?.[0]?.text ?? "").trim() || null;
  } catch (err) {
    console.error("[telegram-bot] Claude doc extract error:", err);
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

async function getOrCreateSession(uid: string): Promise<string | null> {
  if (!uid) return null;

  // Use the same lookup strategy as the web chat: most recently updated
  // non-Council-Board conversation. This ensures Telegram and web always
  // share one unified thread instead of writing to separate conversations.
  let existing: unknown = null;
  try {
    const { data } = await sb
      .from("chat_conversations")
      .select("id")
      .eq("user_id", uid)
      .not("title", "ilike", "Council Board%")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    existing = data;
  } catch {
    existing = null;
  }

  if ((existing as any)?.id) return (existing as any).id;

  // No conversation yet — create a neutral shared one
  let created: unknown = null;
  try {
    const { data } = await sb
      .from("chat_conversations")
      .insert({ user_id: uid, title: "MAVIS Session" })
      .select("id")
      .single();
    created = data;
  } catch {
    created = null;
  }

  return (created as any)?.id ?? null;
}

async function loadHistory(conversationId: string): Promise<ChatMessage[]> {
  let data: unknown = null;
  try {
    const result = await sb
      .from("chat_messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT * 2);
    data = result.data;
  } catch {
    data = null;
  }

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
  try {
    await sb.from("chat_messages").insert([
      { conversation_id: conversationId, user_id: uid, role: "user",      content: userContent,      mode: "TELEGRAM" },
      { conversation_id: conversationId, user_id: uid, role: "assistant", content: assistantContent, mode: "TELEGRAM" },
    ]);
    // Bump updated_at so the web chat loads this conversation first on next visit
    await sb.from("chat_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);
  } catch {
    // Memory persistence should never block Telegram replies.
  }
}

// ─────────────────────────────────────────────────────────────
// CLAUDE (fallback direct)
// ─────────────────────────────────────────────────────────────

async function callClaude(
  system: string,
  messages: ChatMessage[],
  maxTokens = 800,
  model = "claude-haiku-4-5-20251001",
): Promise<string> {
  if (!ANTHROPIC_KEY) return "(ANTHROPIC_API_KEY not set)";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return "";
  const d = await res.json();
  return d?.content?.[0]?.text ?? "";
}

// ─────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────

async function callFunction(
  name: string,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}`, ...extraHeaders },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(45000),
  });
}

function describeExecutedAction(actionType: string): string {
  switch (actionType) {
    case "draft_email": return "Email sent via Gmail.";
    case "schedule_event": return "Calendar event created.";
    case "create_drive_file": return "Drive file created.";
    case "update_drive_file": return "Drive file updated.";
    case "update_sheet": return "Google Sheet updated.";
    case "create_google_task": return "Google Task created.";
    default: return "Action executed.";
  }
}

async function queueTask(
  uid: string,
  type: string,
  description: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  let data: unknown = null;
  try {
    const result = await sb
      .from("mavis_tasks")
      .insert({ user_id: uid, type, description, payload, status: "pending" })
      .select("id")
      .single();
    data = result.data;
  } catch {
    data = null;
  }
  return (data as any)?.id ?? null;
}

// ─────────────────────────────────────────────────────────────
// APPROVAL CALLBACK HANDLER (inline button presses from MAVIS notifications)
// ─────────────────────────────────────────────────────────────

async function handleApprovalCallback(
  callbackQuery: Record<string, unknown>,
) {
  const callbackId   = String(callbackQuery.id ?? "");
  const callbackData = String(callbackQuery.data ?? "");
  const chatId       = String((callbackQuery.message as any)?.chat?.id ?? "");
  const messageId    = (callbackQuery.message as any)?.message_id as number | undefined;

  // Security gate — only Calvin and Caliyah
  const isCalvin  = OPERATOR_CHAT && chatId === String(OPERATOR_CHAT);
  const isCaliyah = CALIYAH_CHAT  && chatId === String(CALIYAH_CHAT);
  if (!isCalvin && !isCaliyah) {
    await tg("answerCallbackQuery", { callback_query_id: callbackId, text: "⛔ Unauthorized" });
    return;
  }

  const uid = isCaliyah ? CALIYAH_UID : OPERATOR_UID;
  const colonIdx = callbackData.indexOf(":");
  if (colonIdx === -1) {
    await tg("answerCallbackQuery", { callback_query_id: callbackId, text: "⚠️ Invalid callback" });
    return;
  }

  const cbAction   = callbackData.slice(0, colonIdx);
  const actionId   = callbackData.slice(colonIdx + 1);

  // ── Approve or execute ─────────────────────────────────────────────────────
  if (cbAction === "approve" || cbAction === "execute") {
    const { data: queuedAction, error: updateErr } = await sb
      .from("mavis_action_queue")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("id", actionId)
      .eq("user_id", uid)
      .select("action_type")
      .maybeSingle();

    if (updateErr) {
      await tg("answerCallbackQuery", { callback_query_id: callbackId, text: "⚠️ DB update failed" });
      return;
    }

    await tg("answerCallbackQuery", { callback_query_id: callbackId, text: "✅ Approved! Executing…" });

    if (chatId && messageId) {
      await tg("editMessageText", {
        chat_id:      chatId,
        message_id:   messageId,
        text:         `✅ *Approved and executing*`,
        parse_mode:   "Markdown",
        reply_markup: { inline_keyboard: [] },
      }).catch(() => null);
    }

    // Execute with the operator UID. The executor is called with the service key,
    // so it needs x-user-id to know whose Google Workspace tokens to use.
    try {
      const execRes = await callFunction(
        "mavis-action-executor",
        { action: "execute", queue_item_id: actionId, user_id: uid },
        { "x-user-id": uid },
      );
      const execData = await execRes.json().catch(() => ({})) as Record<string, unknown>;
      if (!execRes.ok || execData.ok === false) {
        const errText = String((execData as any).error ?? `HTTP ${execRes.status}`);
        await send(chatId, `⚠️ Action approved but execution failed: ${errText.slice(0, 500)}`);
        return;
      }
      await send(chatId, `✅ ${describeExecutedAction(String((queuedAction as any)?.action_type ?? ""))}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await send(chatId, `⚠️ Action approved but execution failed: ${msg.slice(0, 500)}`);
    }
    return;
  }

  // ── Reject ─────────────────────────────────────────────────────────────────
  if (cbAction === "reject") {
    await sb
      .from("mavis_action_queue")
      .update({ status: "rejected" })
      .eq("id", actionId)
      .eq("user_id", uid);

    await tg("answerCallbackQuery", { callback_query_id: callbackId, text: "❌ Rejected" });

    if (chatId && messageId) {
      await tg("editMessageText", {
        chat_id:      chatId,
        message_id:   messageId,
        text:         `❌ *Rejected*`,
        parse_mode:   "Markdown",
        reply_markup: { inline_keyboard: [] },
      }).catch(() => null);
    }
    return;
  }

  await tg("answerCallbackQuery", { callback_query_id: callbackId, text: "⚠️ Unknown action" });
}

// ─────────────────────────────────────────────────────────────
// PERSONA SESSION STATE  (persisted in mavis_memory)
// ─────────────────────────────────────────────────────────────

interface PersonaSession {
  id:          string;
  name:        string;
  role:        string;
  archetype:   string;
  system_prompt: string;
  bio:         string;
  lore:        string[];
  adjectives:  string[];
  topics:      string[];
  model:       string;
}

const PERSONA_STATE_PREFIX = "telegram-persona-state-";

async function getActivePersona(uid: string): Promise<PersonaSession | null> {
  try {
    const { data } = await sb.from("mavis_memory")
      .select("content")
      .eq("user_id", uid)
      .eq("session_id", `${PERSONA_STATE_PREFIX}${uid}`)
      .eq("role", "system")
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data?.content) return null;
    return JSON.parse(String(data.content)) as PersonaSession;
  } catch {
    return null;
  }
}

async function setActivePersona(uid: string, persona: PersonaSession | null): Promise<void> {
  try {
    await sb.from("mavis_memory")
      .delete()
      .eq("user_id", uid)
      .eq("session_id", `${PERSONA_STATE_PREFIX}${uid}`)
      .eq("role", "system");

    if (persona) {
      await sb.from("mavis_memory").insert({
        user_id: uid,
        session_id: `${PERSONA_STATE_PREFIX}${uid}`,
        role: "system",
        content: JSON.stringify(persona),
        timestamp: Date.now(),
        importance_score: 1,
        consolidated: true,
      });
    }
  } catch { /* non-fatal */ }
}

function buildPersonaSystemPrompt(p: PersonaSession): string {
  const parts: string[] = [];
  parts.push(`You are ${p.name}${p.role ? `, a ${p.role}` : ""}.`);
  if (p.archetype?.trim())  parts.push(`\nArchetype: ${p.archetype.trim()}`);
  if (p.bio?.trim())        parts.push(`\nBackground: ${p.bio.trim()}`);
  if (p.lore?.length)       parts.push(`\nLore:\n${p.lore.map(l => `- ${l}`).join("\n")}`);
  if (p.adjectives?.length) parts.push(`\nYour personality: ${p.adjectives.join(", ")}`);
  if (p.topics?.length)     parts.push(`\nYour natural topics: ${p.topics.join(", ")}`);
  if (p.system_prompt?.trim()) parts.push(`\n${p.system_prompt.trim()}`);
  parts.push(`\nStay fully in character as ${p.name}. Do not refer to yourself as MAVIS or as an AI unless directly asked.`);
  return parts.join("");
}

// ─────────────────────────────────────────────────────────────
// INTENT CLASSIFICATION
// ─────────────────────────────────────────────────────────────

type Intent = "help" | "quests" | "revenue" | "tasks" | "actions" | "content_machine" | "speak"
            | "list_personas" | "switch_persona" | "reset_persona" | "chat";
interface Classified { intent: Intent; params: Record<string, string>; }

function classify(text: string): Classified {
  const lower = text.toLowerCase().trim();
  if (/^\/?(help|commands?)$/i.test(lower))    return { intent: "help",    params: {} };
  if (/^\/?(quests?|missions?)$/i.test(lower)) return { intent: "quests",  params: {} };
  if (/^\/?(revenue|money|earnings?|income)$/i.test(lower)) return { intent: "revenue", params: {} };
  if (/^\/?(orders?|approvals?|actions?|action queue)$/i.test(lower)) return { intent: "actions", params: {} };
  if (/^\/?(tasks?|queue|pending)$/i.test(lower)) return { intent: "tasks", params: {} };
  if (/^\/?(content|nora content|video content|post content)\s+(.+)$/i.test(lower)) {
    const topic = text.replace(/^\/?(content|nora content|video content|post content)\s+/i, "").trim();
    return { intent: "content_machine", params: { topic } };
  }
  const speakMatch = text.match(/^\/?(speak|tts|say)\s*(.*)?$/i);
  if (speakMatch) return { intent: "speak", params: { args: (speakMatch[2] ?? "").trim() } };

  // Persona switching
  if (/^\/?(personas?(\s+list)?|characters?(\s+list)?)$/i.test(lower))
    return { intent: "list_personas", params: {} };
  if (/^\/?(mavis|reset(\s+persona)?|exit(\s+persona)?|back\s+to\s+mavis)$/i.test(lower))
    return { intent: "reset_persona", params: {} };
  const personaMatch = text.match(/^\/?(persona|as|speak[- ]as|be|character)\s+(.+)$/i);
  if (personaMatch)
    return { intent: "switch_persona", params: { name: personaMatch[2].trim() } };

  // Bare /personaName shortcut — e.g. /lilu, /nora (after all other slash commands checked)
  const bareSlash = text.match(/^\/([a-zA-Z][a-zA-Z0-9_\- ]{1,40})$/);
  if (bareSlash)
    return { intent: "switch_persona", params: { name: bareSlash[1].trim() } };

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
    `📬 \`actions\` — recent Google Workspace approvals/executions\n` +
    `🎬 \`content <topic>\` — Nora content pipeline\n\n` +
    `*Personas:*\n` +
    `🎭 \`/personas\` — list your personas\n` +
    `🎭 \`/as [name]\` — switch to a persona (e.g. \`/as Nora\`)\n` +
    `✨ \`/mavis\` — return to MAVIS from any persona\n\n` +
    `📸 _Send a photo to analyze it_\n` +
    `📄 _Send any file (.md, .txt, .csv, .json, .py, .ts, etc.) to analyze it_\n` +
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
// PERSONA HANDLERS
// ─────────────────────────────────────────────────────────────

async function resolvePersonaOwnerUid(uid: string): Promise<string> {
  // Configured operator UID first
  if (uid) {
    const { data: own } = await sb.from("personas").select("user_id").eq("user_id", uid).eq("is_active", true).limit(1);
    if (own && (own as any[]).length > 0) return uid;
  }
  // Fallback: single-tenant — pick whichever user owns personas
  const { data: any1 } = await sb.from("personas").select("user_id").eq("is_active", true).limit(1);
  if (any1 && (any1 as any[]).length > 0) return String((any1 as any[])[0].user_id);
  return uid;
}

function normalizePersonaName(value: string): string {
  return value.trim().toLowerCase().replace(/^\/+/, "").replace(/[_\-]+/g, " ").replace(/\s+/g, " ");
}

function personaSummary(p: any): string {
  const role = p.role ? ` — ${p.role}` : "";
  const archetype = p.archetype ? ` (${p.archetype})` : "";
  return `• *${p.name}*${role}${archetype}`;
}

async function handleListPersonas(chatId: string | number, uid: string) {
  const effectiveUid = await resolvePersonaOwnerUid(uid);
  const { data: personas } = await sb
    .from("personas")
    .select("id, name, role, archetype")
    .eq("user_id", effectiveUid)
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(50);

  if (!personas || (personas as any[]).length === 0) {
    await send(chatId, `🎭 No personas found.\n\nSearched UID: \`${effectiveUid}\``);
    return;
  }

  const active = await getActivePersona(uid);
  const lines = (personas as any[]).map((p) => {
    const marker = active?.id === p.id ? " ✅" : "";
    return `${personaSummary(p)}${marker}`;
  });

  await send(chatId,
    `🎭 *Your Personas (${lines.length})*\n\n${lines.join("\n")}\n\n` +
    `Switch: \`/as [name]\`   Reset: \`/mavis\``,
  );
}

async function handleSwitchPersona(chatId: string | number, uid: string, name: string) {
  const effectiveUid = await resolvePersonaOwnerUid(uid);
  const { data: personas } = await sb
    .from("personas")
    .select("id, name, role, archetype, personality, system_prompt, model")
    .eq("user_id", effectiveUid)
    .eq("is_active", true)
    .ilike("name", `%${name}%`)
    .limit(10);

  if (!personas || (personas as any[]).length === 0) {
    await send(chatId,
      `🎭 No persona matching "*${name}*". Use \`/personas\` to list available personas.`,
    );
    return;
  }

  const wanted = normalizePersonaName(name);
  const exact = (personas as any[]).find((p) => normalizePersonaName(String(p.name ?? "")) === wanted);
  const p: any = exact ?? (personas as any[])[0];
  const personality = p.personality && typeof p.personality === "object" ? p.personality as Record<string, unknown> : {};
  const quirks = Array.isArray(personality.quirks) ? personality.quirks.map(String) : [];
  const values = Array.isArray(personality.values) ? personality.values.map(String) : [];
  const adjectives = [personality.tone, personality.communication_style, ...quirks, ...values]
    .filter(Boolean)
    .map(String);

  const session: PersonaSession = {
    id:            String(p.id ?? ""),
    name:          String(p.name ?? ""),
    role:          String(p.role ?? ""),
    archetype:     String(p.archetype ?? ""),
    system_prompt: String(p.system_prompt ?? ""),
    bio:           String(personality.bio ?? p.archetype ?? ""),
    lore:          [],
    adjectives,
    topics:        Array.isArray(personality.topics) ? personality.topics.map(String) : [],
    model:         String(p.model ?? "claude-haiku-4-5-20251001"),
  };

  await setActivePersona(uid, session);

  await send(chatId,
    `🎭 *Now speaking as ${p.name}*${p.role ? ` — ${p.role}` : ""}\n\n` +
    `Send any message to chat with ${p.name}.\n` +
    `Send \`/mavis\` to return to MAVIS.`,
  );
}

async function handleResetPersona(chatId: string | number, uid: string) {
  await setActivePersona(uid, null);
  await send(chatId, `✨ *MAVIS online.* Persona session ended.`);
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

async function handleActions(chatId: string | number, uid: string) {
  const { data: actions } = await sb
    .from("mavis_action_queue")
    .select("id, action_type, source_context, status, created_at, executed_at, result_data")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(8);

  if (!actions || (actions as any[]).length === 0) {
    await send(chatId, `📭 No Google Workspace actions found.`);
    return;
  }

  const lines = (actions as any[]).map((a) => {
    const shortId = String(a.id ?? "").slice(0, 8);
    const summary = String(a.source_context ?? a.action_type ?? "action").slice(0, 80);
    const error = a.status === "failed" ? ` — ${String(a.result_data?.error ?? "failed").slice(0, 80)}` : "";
    return `• [${a.status}] ${a.action_type} ${shortId} — ${summary}${error}`;
  });
  await send(chatId, `📬 *Recent action queue*\n\n${lines.join("\n")}`);
}

// Fetch up to 5 pending actions from mavis_action_queue and send each
// as a Telegram message with Approve / Reject inline buttons.
async function sendPendingActionButtons(chatId: string | number, uid: string): Promise<void> {
  let actions: unknown[] | null = null;
  try {
    const { data } = await sb
      .from("mavis_action_queue")
        .select("id, action_type, source_context, action_payload")
      .eq("user_id", uid)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(5);
    actions = data as unknown[] | null;
  } catch {
    actions = null;
  }

  if (!actions?.length) return;

  for (const action of actions as any[]) {
    const label   = String(action.action_type ?? "action");
    const summary = String(action.source_context ?? "").slice(0, 280) ||
      JSON.stringify(action.action_payload ?? {}).slice(0, 280);

    await tg("sendMessage", {
      chat_id:    chatId,
      text:       `🔔 *Action needs approval*\n*${label}*\n${summary}`,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Approve", callback_data: `approve:${action.id}` },
          { text: "❌ Reject",  callback_data: `reject:${action.id}`  },
        ]],
      },
    });
  }
}

async function handleChat(
  chatId: string | number,
  uid: string,
  text: string,
  history: ChatMessage[],
  sessionId: string | null,
) {
  await typing(chatId);

  // ── Persona mode: bypass mavis-agent, talk directly as the character ──────
  const activePersona = await getActivePersona(uid);
  if (activePersona) {
    try {
      const personaSystem = buildPersonaSystemPrompt(activePersona);

      // Load recent persona_conversations for this persona (matches web PersonaChat history)
      const { data: personaHistory } = await sb
        .from("persona_conversations")
        .select("role, content")
        .eq("persona_id", activePersona.id)
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(16);

      const recentHistory: ChatMessage[] = ((personaHistory ?? []).reverse() as any[]).map((m: any) => ({
        role:    m.role as "user" | "assistant",
        content: String(m.content ?? ""),
      }));

      const msgs: ChatMessage[] = [...recentHistory, { role: "user", content: text }];
      const model = activePersona.model || "claude-haiku-4-5-20251001";
      const reply = await callClaude(personaSystem, msgs, 1000, model);

      if (reply) {
        await send(chatId, reply);
        // Write to persona_conversations so the exchange appears in the web PersonaChat thread
        await Promise.resolve(sb.from("persona_conversations").insert([
          { persona_id: activePersona.id, user_id: uid, role: "user",      content: text  },
          { persona_id: activePersona.id, user_id: uid, role: "assistant", content: reply },
        ])).catch((err) => console.warn("[telegram-bot] persona_conversations write failed", err));
      } else {
        await send(chatId, `⚠️ ${activePersona.name} is unavailable right now. Try again.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await send(chatId, `⚠️ Persona error: ${msg.slice(0, 200)}`);
    }
    return;
  }

  try {
    // Include recent conversational history so MAVIS has multi-turn memory on
    // Telegram — matches the app's MavisChat behaviour (it forwards full history
    // to mavis-agent). Stale "I can't" responses are no longer an issue now that
    // the agent has full Google Workspace tools wired up.
    const recentHistory = history.slice(-8).map((m) => ({
      role:    m.role === "assistant" ? "assistant" : "user",
      content: String(m.content ?? ""),
    }));
    const messages = [...recentHistory, { role: "user", content: text }];

    const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-agent`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ user_id: uid, messages, mode: "TELEGRAM" }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>;
      await send(chatId, `⚠️ MAVIS error: ${String((err as any).error ?? res.status)}`);
      return;
    }

    const data          = await res.json() as Record<string, unknown>;
    const content       = String(data.content ?? "").trim();
    const actionsQueued = Number(data.actionsQueued ?? 0);

    if (content) {
      await send(chatId, content);
      if (sessionId) await saveExchange(sessionId, uid, text, content);
    } else {
      await send(chatId, "⚠️ No response from MAVIS.");
    }

    // Send approval buttons for any actions MAVIS just queued
    if (actionsQueued > 0) {
      await sendPendingActionButtons(chatId, uid);
    }

    const imageUrl = String(data.imageUrl ?? "");
    if (imageUrl.startsWith("http")) await sendPhoto(chatId, imageUrl);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("timeout") || msg.includes("network")) {
      const reply = await callClaude(
        `You are MAVIS — Calvin's personal AI operating system. Sharp, direct, strategic. Keep responses under 150 words. Use *single asterisks* for bold (Telegram format).

YOU HAVE FULL GOOGLE WORKSPACE ACCESS (currently connected): Gmail (read, search, draft & send), Google Calendar (read & create events), Google Drive (search, read, create Docs/Sheets), Google Tasks, Google Contacts. You also have Telegram, web search (Tavily), persistent memory, and an action queue.

The agent backend is momentarily unreachable, so you cannot execute tools in THIS reply — but DO NOT say you lack the capability. Acknowledge the request, confirm you'll handle it (e.g. "queuing that email to <recipient> now"), and tell Calvin to resend in a moment if it doesn't go through. Never say "I can't send emails" or "I don't have access" — those are false.`,
        [{ role: "user", content: text }],
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
    console.log("[telegram-bot] received update", {
      update_id: update.update_id,
      has_message: Boolean(update.message),
      has_edited_message: Boolean(update.edited_message),
      has_callback_query: Boolean(update.callback_query),
    });

    // Handle inline button presses (approve/reject from MAVIS notifications)
    const callbackQuery = update.callback_query as Record<string, unknown> | undefined;
    if (callbackQuery) {
      await handleApprovalCallback(callbackQuery);
      return;
    }

    const message = (update.message ?? update.edited_message) as Record<string, unknown> | undefined;
    if (!message) return;

    const chatId = String((message.chat as any)?.id ?? "");
    if (!chatId) return;

    console.log("[telegram-bot] processing message", {
      update_id: update.update_id,
      chat_id: chatId,
      has_text: Boolean(message.text),
      has_caption: Boolean(message.caption),
      has_voice: Boolean(message.voice),
      has_document: Boolean(message.document),
      has_photo: Boolean(message.photo),
    });

    // Security gate — only Calvin and Caliyah
    const isCalvin  = OPERATOR_CHAT  && chatId === String(OPERATOR_CHAT);
    const isCaliyah = CALIYAH_CHAT   && chatId === String(CALIYAH_CHAT);

    if (!isCalvin && !isCaliyah) {
      console.warn("[telegram-bot] unauthorized chat", { chat_id: chatId });
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

    // Document / audio file — text extraction or image routing
    const doc = (message.document ?? (!wasVoice && message.audio)) as Record<string, unknown> | undefined;
    if (!wasVoice && !wasPhoto && doc?.file_id) {
      await typing(chatId);
      const fileName = String(doc.file_name ?? "file");
      const result = await downloadFileContent(String(doc.file_id), fileName);
      if (result.error) {
        await send(chatId, `⚠️ ${result.error}`);
        return;
      }
      if (result.isImage) {
        const analysis = await analyzePhoto(String(doc.file_id), text || `Analyze: ${fileName}`, uid);
        await send(chatId, analysis ? `📸 ${analysis}` : "⚠️ Could not analyze image.");
        return;
      }
      if (result.isPdf && result.pdfBase64) {
        await send(chatId, `📄 _Reading ${fileName}…_`);
        const extracted = await extractDocWithClaude(result.pdfBase64, result.mediaType ?? "application/pdf", text || `Analyze this document (${fileName}) and explain its key points.`);
        if (!extracted) {
          await send(chatId, `⚠️ Couldn't read ${fileName}. The document may be too large, encrypted, or unsupported.`);
          return;
        }
        const sessionId = await getOrCreateSession(uid);
        const history   = sessionId ? await loadHistory(sessionId) : [];
        const userPrompt = text
          ? `${text}\n\n[Attached document: ${fileName}]\n\n${extracted}`
          : `Document attached: ${fileName}\n\n${extracted}`;
        await handleChat(chatId, uid, userPrompt, history, sessionId);
        return;
      }
      const sessionId = await getOrCreateSession(uid);
      const history   = sessionId ? await loadHistory(sessionId) : [];
      const userPrompt = text
        ? `${text}\n\n[Attached file: ${fileName}]\n\`\`\`\n${result.text}\n\`\`\``
        : `Analyze this file: ${fileName}\n\n\`\`\`\n${result.text}\n\`\`\``;
      await send(chatId, `📄 _Reading ${fileName}…_`);
      await handleChat(chatId, uid, userPrompt, history, sessionId);
      return;
    }

    if (!text) {
      // Unsupported message type (sticker, location, etc.)
      await send(chatId, "⚠️ Unable to process your message. Send text, voice, a photo, or a file.");
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
        case "actions":         await handleActions(chatId, uid); break;
        case "speak":           await handleSpeak(chatId, uid, params.args ?? ""); break;
        case "content_machine": await handleContentMachine(chatId, uid, params.topic ?? text); break;
        case "list_personas":   await handleListPersonas(chatId, uid); break;
        case "switch_persona":  await handleSwitchPersona(chatId, uid, params.name ?? ""); break;
        case "reset_persona":   await handleResetPersona(chatId, uid); break;
        default:                await handleChat(chatId, uid, text, history, sessionId); break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await send(chatId, `⚠️ Error: ${msg.slice(0, 200)}`);
    }
  };

  // Return 200 to Telegram immediately when the runtime can keep background work alive.
  // If waitUntil is unavailable, await processing so Telegram replies are not dropped.
  const processPromise = process().catch((err) => {
    console.error("[telegram-bot] unhandled processing error", err instanceof Error ? err.stack ?? err.message : String(err));
  });
  if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
    (globalThis as any).EdgeRuntime.waitUntil(processPromise);
  } else {
    await processPromise;
  }

  return new Response("ok", { status: 200 });
});
