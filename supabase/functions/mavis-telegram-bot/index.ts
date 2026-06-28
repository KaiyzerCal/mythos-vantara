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
const GEMINI_KEY     = Deno.env.get("GEMINI_API_KEY") ?? Deno.env.get("GOOGLE_API_KEY") ?? "";
const XAI_KEY        = Deno.env.get("XAI_API_KEY") ?? Deno.env.get("GROK_API_KEY") ?? "";

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
// FREE-GEMINI-FIRST LLM ROUTER
// Cascade: gemini-2.0-flash (free) → gemini-2.0-flash-lite (free)
//          → explicit persona/council model → Claude Haiku → GPT-4o-mini
// ─────────────────────────────────────────────────────────────

// Circuit breaker — survives warm Deno isolate; prevents hammering degraded providers.
const _llmUnhealthyUntil = new Map<string, number>();
function _isUnhealthy(key: string): boolean {
  const t = _llmUnhealthyUntil.get(key);
  return t !== undefined && Date.now() < t;
}
function _markUnhealthy(key: string, ttlMs = 120_000): void {
  _llmUnhealthyUntil.set(key, Date.now() + ttlMs);
}

function detectProvider(model: string): "anthropic" | "openai" | "gemini" | "xai" {
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("gemini-")) return "gemini";
  if (model.startsWith("grok-"))   return "xai";
  return "openai";
}

async function _callGeminiModel(model: string, system: string, messages: ChatMessage[], maxTokens: number): Promise<string> {
  const contents = messages.map((m) => ({
    role:  m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { maxOutputTokens: maxTokens },
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    if (res.status === 429) _markUnhealthy(model, 60_000);
    else if (res.status >= 400) _markUnhealthy(model);
    throw new Error(`Gemini ${model} ${res.status}: ${errText.slice(0, 150)}`);
  }
  const d = await res.json();
  return d?.candidates?.[0]?.content?.parts?.find((p: any) => p.text && !p.thought)?.text ?? "";
}

async function _callAnthropicModel(model: string, system: string, messages: ChatMessage[], maxTokens: number): Promise<string> {
  // Merge consecutive same-role messages (Anthropic strict alternation requirement)
  const merged: { role: string; content: string }[] = [];
  for (const m of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + m.content;
    else merged.push({ role: m.role, content: m.content });
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body:    JSON.stringify({ model, max_tokens: maxTokens, system, messages: merged }),
    signal:  AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    _markUnhealthy(model);
    throw new Error(`Anthropic ${model} ${res.status}: ${errText.slice(0, 150)}`);
  }
  const d = await res.json();
  const blocks: any[] = Array.isArray(d.content) ? d.content : [];
  return blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("") || "";
}

async function _callOpenAIModel(model: string, system: string, messages: ChatMessage[], maxTokens: number): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
    body:    JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, ...messages] }),
    signal:  AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    _markUnhealthy(model);
    throw new Error(`OpenAI ${model} ${res.status}: ${errText.slice(0, 150)}`);
  }
  const d = await res.json();
  return d?.choices?.[0]?.message?.content ?? "";
}

async function _callXAIModel(model: string, system: string, messages: ChatMessage[], maxTokens: number): Promise<string> {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${XAI_KEY}` },
    body:    JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, ...messages] }),
    signal:  AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    _markUnhealthy(model);
    throw new Error(`xAI ${model} ${res.status}: ${errText.slice(0, 150)}`);
  }
  const d = await res.json();
  return d?.choices?.[0]?.message?.content ?? "";
}

// Main cascade. If model is provided, it's tried AFTER the free Gemini tiers.
async function callLLM(
  model: string,
  system: string,
  messages: ChatMessage[],
  maxTokens = 800,
): Promise<string> {
  // ── Tier 1: Free Gemini 2.0 Flash (15 RPM) ────────────────────────────
  if (GEMINI_KEY && !_isUnhealthy("gemini-2.0-flash")) {
    try {
      const text = await _callGeminiModel("gemini-2.0-flash", system, messages, maxTokens);
      if (text) return text;
    } catch (err) {
      console.warn("[llm] gemini-2.0-flash failed:", err instanceof Error ? err.message : String(err));
    }
  }

  // ── Tier 2: Free Gemini 2.0 Flash Lite (30 RPM, separate quota) ───────
  if (GEMINI_KEY && !_isUnhealthy("gemini-2.0-flash-lite")) {
    try {
      const text = await _callGeminiModel("gemini-2.0-flash-lite", system, messages, maxTokens);
      if (text) return text;
    } catch (err) {
      console.warn("[llm] gemini-2.0-flash-lite failed:", err instanceof Error ? err.message : String(err));
    }
  }

  // ── Tier 3: Persona/council's assigned model ───────────────────────────
  const effectiveModel = model || "claude-haiku-4-5-20251001";
  const provider       = detectProvider(effectiveModel);
  // Skip if it's a Gemini model we already tried
  const isFreeTier = effectiveModel === "gemini-2.0-flash" || effectiveModel === "gemini-2.0-flash-lite";
  if (!isFreeTier && !_isUnhealthy(effectiveModel)) {
    try {
      if (provider === "gemini"    && GEMINI_KEY)    return await _callGeminiModel(effectiveModel, system, messages, maxTokens);
      if (provider === "anthropic" && ANTHROPIC_KEY) return await _callAnthropicModel(effectiveModel, system, messages, maxTokens);
      if (provider === "openai"    && OPENAI_KEY)    return await _callOpenAIModel(effectiveModel, system, messages, maxTokens);
      if (provider === "xai"       && XAI_KEY)       return await _callXAIModel(effectiveModel, system, messages, maxTokens);
    } catch (err) {
      console.warn(`[llm] ${effectiveModel} failed:`, err instanceof Error ? err.message : String(err));
    }
  }

  // ── Tier 4: Claude Haiku fallback ─────────────────────────────────────
  if (ANTHROPIC_KEY && effectiveModel !== "claude-haiku-4-5-20251001" && !_isUnhealthy("claude-haiku-4-5-20251001")) {
    try {
      return await _callAnthropicModel("claude-haiku-4-5-20251001", system, messages, maxTokens);
    } catch (err) {
      console.warn("[llm] claude-haiku fallback failed:", err instanceof Error ? err.message : String(err));
    }
  }

  // ── Tier 5: GPT-4o-mini fallback ──────────────────────────────────────
  if (OPENAI_KEY && effectiveModel !== "gpt-4o-mini" && !_isUnhealthy("gpt-4o-mini")) {
    try {
      return await _callOpenAIModel("gpt-4o-mini", system, messages, maxTokens);
    } catch (err) {
      console.warn("[llm] gpt-4o-mini fallback failed:", err instanceof Error ? err.message : String(err));
    }
  }

  // ── Tier 6: Grok last resort ───────────────────────────────────────────
  if (XAI_KEY && !_isUnhealthy("grok-3-mini")) {
    try {
      return await _callXAIModel("grok-3-mini", system, messages, maxTokens);
    } catch (err) {
      console.warn("[llm] grok-3-mini fallback failed:", err instanceof Error ? err.message : String(err));
    }
  }

  return "";
}

// Kept for internal use (non-persona calls that always use Claude Haiku)
async function callClaude(
  system: string,
  messages: ChatMessage[],
  maxTokens = 800,
  model = "claude-haiku-4-5-20251001",
): Promise<string> {
  return callLLM(model, system, messages, maxTokens);
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
    // Gmail
    case "draft_email": case "send_email": return "Email sent via Gmail.";
    case "get_emails":       return "Emails fetched from Gmail.";
    case "get_email_thread": return "Email thread fetched.";
    case "archive_email":    return "Email archived.";
    case "delete_email":     return "Email deleted.";
    case "mark_email":       return "Email marked.";
    // Calendar
    case "schedule_event": case "create_event": return "Calendar event created.";
    case "get_calendar_events":   return "Calendar events fetched.";
    case "get_availability":      return "Availability checked.";
    case "update_calendar_event": return "Calendar event updated.";
    case "delete_calendar_event": return "Calendar event deleted.";
    case "schedule_meet":         return "Google Meet scheduled.";
    // Tasks
    case "create_google_task":    return "Google Task created.";
    case "list_google_tasks":     return "Google Tasks fetched.";
    case "complete_google_task":  return "Google Task completed.";
    case "update_google_task":    return "Google Task updated.";
    // Drive
    case "create_drive_file": case "create_drive_folder": return "Drive folder/file created.";
    case "update_drive_file": return "Drive file updated.";
    case "list_drive_files":  return "Drive files listed.";
    case "search_drive_files": return "Drive files searched.";
    case "get_file_info":     return "Drive file info fetched.";
    case "read_drive_file":   return "Drive file content read.";
    case "move_file":         return "Drive file moved.";
    case "rename_file":       return "Drive file renamed.";
    case "delete_file":       return "Drive file deleted.";
    case "share_file":        return "Drive file shared.";
    // Docs / Sheets / Slides
    case "read_document":        return "Google Doc read.";
    case "update_sheet":
    case "create_sheet":         return "Google Sheet updated.";
    case "read_sheet":           return "Google Sheet read.";
    case "create_presentation":  return "Google Slides presentation created.";
    case "read_presentation":    return "Google Slides read.";
    // Contacts
    case "create_contact":  return "Google Contact created.";
    case "list_contacts":   return "Google Contacts listed.";
    case "search_contacts": return "Google Contacts searched.";
    case "update_contact":  return "Google Contact updated.";
    case "delete_contact":  return "Google Contact deleted.";
    // Business Profile
    case "get_gbp_reviews":   return "Google Business reviews fetched.";
    case "respond_to_review": return "Google review response posted.";
    case "create_gbp_post":   return "Google Business post created.";
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

function buildPersonaSystemPrompt(p: PersonaSession, appCtx = ""): string {
  const parts: string[] = [];
  parts.push(`You are ${p.name}${p.role ? `, a ${p.role}` : ""}.`);
  if (p.archetype?.trim())     parts.push(`\nArchetype: ${p.archetype.trim()}`);
  if (p.bio?.trim())           parts.push(`\nBackground: ${p.bio.trim()}`);
  if (p.lore?.length)          parts.push(`\nLore:\n${p.lore.map(l => `- ${l}`).join("\n")}`);
  if (p.adjectives?.length)    parts.push(`\nYour personality: ${p.adjectives.join(", ")}`);
  if (p.topics?.length)        parts.push(`\nYour natural topics: ${p.topics.join(", ")}`);
  if (p.system_prompt?.trim()) parts.push(`\n${p.system_prompt.trim()}`);
  parts.push(`\nStay fully in character as ${p.name}. Do not refer to yourself as MAVIS or as an AI unless directly asked.`);
  if (appCtx) parts.push(`\n\n${appCtx}`);
  parts.push(`\n\n${ACTION_MECHANIC_PROMPT}`);
  return parts.join("");
}

// ─────────────────────────────────────────────────────────────
// COUNCIL SESSION STATE  (persisted in mavis_memory, same approach as persona)
// ─────────────────────────────────────────────────────────────

interface CouncilSession {
  id:               string;
  name:             string;
  role:             string;
  specialty:        string;
  personality_prompt: string;
  notes:            string;
  model:            string;
}

const COUNCIL_STATE_PREFIX = "telegram-council-state-";

async function getActiveCouncil(uid: string): Promise<CouncilSession | null> {
  try {
    const { data } = await sb.from("mavis_memory")
      .select("content")
      .eq("user_id", uid)
      .eq("session_id", `${COUNCIL_STATE_PREFIX}${uid}`)
      .eq("role", "system")
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data?.content) return null;
    return JSON.parse(String(data.content)) as CouncilSession;
  } catch {
    return null;
  }
}

async function setActiveCouncil(uid: string, council: CouncilSession | null): Promise<void> {
  try {
    await sb.from("mavis_memory")
      .delete()
      .eq("user_id", uid)
      .eq("session_id", `${COUNCIL_STATE_PREFIX}${uid}`)
      .eq("role", "system");

    if (council) {
      await sb.from("mavis_memory").insert({
        user_id:           uid,
        session_id:        `${COUNCIL_STATE_PREFIX}${uid}`,
        role:              "system",
        content:           JSON.stringify(council),
        timestamp:         Date.now(),
        importance_score:  1,
        consolidated:      true,
      });
    }
  } catch { /* non-fatal */ }
}

function buildCouncilSystemPrompt(c: CouncilSession, appCtx = ""): string {
  const parts: string[] = [];
  parts.push(`You are ${c.name}${c.role ? `, ${c.role}` : ""}${c.specialty ? ` specialising in ${c.specialty}` : ""}.`);
  if (c.notes?.trim())              parts.push(`\nBackground: ${c.notes.trim()}`);
  if (c.personality_prompt?.trim()) parts.push(`\n${c.personality_prompt.trim()}`);
  parts.push(`\nYou are a council member advising the operator. Speak directly from your expertise. Be concise and strategic. Do not refer to yourself as MAVIS or as a generic AI.`);
  if (appCtx) parts.push(`\n\n${appCtx}`);
  parts.push(`\n\n${ACTION_MECHANIC_PROMPT}`);
  return parts.join("");
}

// ─────────────────────────────────────────────────────────────
// APP CONTEXT — loaded before every persona/council reply so
// they know what's in the operator's quests, journal, vault, etc.
// ─────────────────────────────────────────────────────────────

const ACTION_MECHANIC_PROMPT = `HIDDEN MECHANICS (never show these blocks in your visible reply):

DIRECT ACTIONS — embed anywhere in your response to write to the app:
:::PROPOSE_ACTION{"type":"<type>","params":{<fields>}}:::

Supported types:
  create_quest       — params: title, description, type (daily|side|main|boss), xp_reward
  complete_quest     — params: title (or id)
  create_journal     — params: title, content, category (general|reflection|gratitude|focus|dream), mood
  create_vault       — params: title, content, category (legal|business|personal|evidence|achievement)
  create_skill       — params: name, category, tier (1–5)
  complete_ritual    — params: name (or id)
  award_xp           — params: amount, reason
  log_expense        — params: description, amount, category (food|transport|entertainment|business|health|other)
  create_note        — params: title, content
  create_ally        — params: name, relationship, notes

QUERY MAVIS — when you need information from MAVIS's memory, the operator's history, or what was discussed with a specific entity:
:::QUERY_MAVIS{"question":"<specific question>","target":"mavis|<persona name>|<council member name>"}:::
MAVIS will look up the answer and replace this block with the actual information inline in your response.
Use this when the operator asks you to check something, recall a past discussion, or get context from another entity.

ESCALATE TO MAVIS — for anything requiring external services (email, calendar, Drive, contacts, image gen, etc.):
:::PROPOSE_MAVIS{"type":"<action_type>","summary":"<one sentence>","details":"<full description>","payload":{<fields>}}:::

Supported action types and their payload fields:

  GMAIL:
    send_email          — to, subject, body, cc?, bcc?
    get_emails          — query?, max_results?, label_ids?
    get_email_thread    — message_id
    archive_email       — message_id
    delete_email        — message_id
    mark_email          — message_id, read ("true"/"false")

  GOOGLE CALENDAR:
    create_event            — title, start, end, description?, location?, attendees?
    get_calendar_events     — time_min?, time_max?, max_results?
    get_availability        — time_min, time_max
    update_calendar_event   — event_id, title?, start?, end?, description?, location?
    delete_calendar_event   — event_id
    schedule_meet           — title, start, end, attendees?, description?

  GOOGLE TASKS:
    list_google_tasks       — tasklist_id?, show_completed?
    complete_google_task    — task_id, tasklist_id?
    update_google_task      — task_id, title?, due?, tasklist_id?

  GOOGLE DRIVE:
    list_drive_files        — folder_id?, max_results?
    search_drive_files      — query, max_results?
    get_file_info           — file_id
    read_drive_file         — file_id
    create_drive_folder     — name, parent_id?
    move_file               — file_id, new_parent_id
    rename_file             — file_id, new_name
    share_file              — file_id, email?, role?, type?
    delete_file             — file_id

  GOOGLE DOCS / SHEETS / SLIDES:
    read_document           — document_id
    create_sheet            — title, headers?
    read_sheet              — spreadsheet_id, range?
    update_sheet            — spreadsheet_id, range, values (JSON 2D array string)
    create_presentation     — title, subtitle?
    read_presentation       — presentation_id

  GOOGLE CONTACTS:
    create_contact          — name, email?, phone?, notes?
    list_contacts           — max_results?
    search_contacts         — query
    update_contact          — resource_name, etag, name?, email?, phone?, notes?
    delete_contact          — resource_name

  GOOGLE BUSINESS PROFILE:
    get_gbp_reviews         — account_id, location_id, max_results?
    respond_to_review       — account_id, location_id, review_id, comment
    create_gbp_post         — account_id, location_id, summary, topic_type, call_to_action_type?, call_to_action_url?

  OTHER:
    propose_product, forge_persona, nora_tweet, autonomous_goal, generate_image,
    create_website, business_strategy, social_campaign, custom_skill_definition, other

Rules:
- Embed blocks BEFORE or WITHIN your visible reply text at the natural point where the info would appear
- QUERY_MAVIS is replaced inline — put it where you want the answer to appear
- Never show the raw block syntax to the user
- Act naturally as your character — these are background operations
- Use PROPOSE_MAVIS for any Google Workspace task — MAVIS will execute it with the operator's connected account`;

async function loadAppContext(uid: string): Promise<string> {
  try {
    const [profileRes, questsRes, journalRes, vaultRes, energyRes, ritualsRes, memoriesRes, skillsRes] =
      await Promise.all([
        sb.from("profiles").select("full_name,level,rank,form,xp,xp_to_next_level,str,agi,int,vit,wis,cha,lck,arc_story").eq("id", uid).maybeSingle(),
        sb.from("quests").select("title,type,status,progress,description").eq("user_id", uid).in("status", ["active","in_progress"]).order("created_at", { ascending: false }).limit(8),
        sb.from("journal_entries").select("title,content,category,mood,created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(5),
        sb.from("vault_entries").select("title,content,category,created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(5),
        sb.from("energy_systems").select("type,current,max,status").eq("user_id", uid).limit(4),
        sb.from("rituals").select("name,type,streak,last_completed").eq("user_id", uid).order("streak", { ascending: false }).limit(6),
        sb.from("mavis_memory").select("content,importance_score").eq("user_id", uid).eq("role", "user").order("importance_score", { ascending: false }).limit(6),
        sb.from("skills").select("name,category,tier,proficiency").eq("user_id", uid).order("proficiency", { ascending: false }).limit(8),
      ]);

    const lines: string[] = ["═══ OPERATOR APP CONTEXT ═══"];

    // Profile
    const pr = profileRes.data as any;
    if (pr) {
      lines.push(`Profile: ${pr.full_name ?? "Operator"} — Lv${pr.level ?? 1} ${pr.rank ?? ""} | Form: ${pr.form ?? "—"}`);
      lines.push(`Stats: STR:${pr.str ?? 0} AGI:${pr.agi ?? 0} INT:${pr.int ?? 0} VIT:${pr.vit ?? 0} WIS:${pr.wis ?? 0} CHA:${pr.cha ?? 0} LCK:${pr.lck ?? 0}`);
      lines.push(`XP: ${pr.xp ?? 0}/${pr.xp_to_next_level ?? 1000}${pr.arc_story ? ` | Arc: ${String(pr.arc_story).slice(0, 80)}` : ""}`);
    }

    // Active quests
    const quests = (questsRes.data ?? []) as any[];
    if (quests.length) {
      lines.push(`\nACTIVE QUESTS (${quests.length}):`);
      for (const q of quests) {
        const prog = q.progress != null ? ` ${q.progress}%` : "";
        lines.push(`• "${q.title}" [${q.type}]${prog} — ${String(q.description ?? "").slice(0, 60)}`);
      }
    }

    // Skills
    const skills = (skillsRes.data ?? []) as any[];
    if (skills.length) {
      lines.push(`\nSKILLS: ${skills.map((s: any) => `${s.name}(T${s.tier ?? 1} ${s.proficiency ?? 0}%)`).join(", ")}`);
    }

    // Journal
    const journal = (journalRes.data ?? []) as any[];
    if (journal.length) {
      lines.push(`\nRECENT JOURNAL:`);
      for (const j of journal) {
        const date = j.created_at ? new Date(j.created_at).toLocaleDateString() : "";
        lines.push(`• [${date}${j.mood ? ` ${j.mood}` : ""}] "${j.title}" — ${String(j.content ?? "").slice(0, 80)}`);
      }
    }

    // Vault
    const vault = (vaultRes.data ?? []) as any[];
    if (vault.length) {
      lines.push(`\nVAULT:`);
      for (const v of vault) {
        lines.push(`• [${v.category ?? "general"}] "${v.title}" — ${String(v.content ?? "").slice(0, 80)}`);
      }
    }

    // Energy
    const energy = (energyRes.data ?? []) as any[];
    if (energy.length) {
      lines.push(`\nENERGY: ${energy.map((e: any) => `${e.type}:${e.current}/${e.max}[${e.status ?? "—"}]`).join("  ")}`);
    }

    // Rituals
    const rituals = (ritualsRes.data ?? []) as any[];
    if (rituals.length) {
      lines.push(`\nRITUALS: ${rituals.map((r: any) => `${r.name}(streak:${r.streak ?? 0})`).join(", ")}`);
    }

    // Recent memories
    const mems = (memoriesRes.data ?? []) as any[];
    if (mems.length) {
      lines.push(`\nMEMORIES:`);
      for (const m of mems) {
        const txt = String(m.content ?? "").slice(0, 100);
        if (txt) lines.push(`• ${txt}`);
      }
    }

    lines.push("═══ END CONTEXT ═══");
    return lines.join("\n");
  } catch (err) {
    console.warn("[telegram-bot] loadAppContext failed:", err instanceof Error ? err.message : String(err));
    return "";
  }
}

// ─────────────────────────────────────────────────────────────
// DIRECT ACTION EXECUTION
// ─────────────────────────────────────────────────────────────

async function executeDirectAction(type: string, params: Record<string, any>, uid: string): Promise<string | null> {
  try {
    switch (type) {
      case "create_quest": {
        const { data } = await sb.from("quests").insert({
          user_id:     uid,
          title:       params.title ?? "Untitled Quest",
          description: params.description ?? "",
          type:        params.type ?? "daily",
          status:      "active",
          xp_reward:   Number(params.xp_reward) || 50,
        }).select("title").single();
        return data ? `Quest created: "${(data as any).title}"` : null;
      }
      case "complete_quest": {
        const filter = params.id
          ? sb.from("quests").update({ status: "completed" }).eq("id", params.id).eq("user_id", uid)
          : sb.from("quests").update({ status: "completed" }).eq("user_id", uid).ilike("title", `%${params.title ?? ""}%`);
        const { data } = await filter.select("title").limit(1).maybeSingle();
        return data ? `Quest completed: "${(data as any).title}"` : "Quest marked complete";
      }
      case "create_journal": {
        const { data } = await sb.from("journal_entries").insert({
          user_id:  uid,
          title:    params.title ?? "Journal Entry",
          content:  params.content ?? "",
          category: params.category ?? "general",
          mood:     params.mood ?? null,
        }).select("title").single();
        return data ? `Journal entry created: "${(data as any).title}"` : null;
      }
      case "create_vault": {
        const VALID_VAULT_CATS = ["legal","business","personal","evidence","achievement"];
        const vaultCat = VALID_VAULT_CATS.includes(params.category) ? params.category : "personal";
        const { data } = await sb.from("vault_entries").insert({
          user_id:  uid,
          title:    params.title ?? "Vault Entry",
          content:  params.content ?? "",
          category: vaultCat,
        }).select("title").single();
        return data ? `Vault entry saved: "${(data as any).title}"` : null;
      }
      case "create_skill": {
        const { data } = await sb.from("skills").insert({
          user_id:  uid,
          name:     params.name ?? "New Skill",
          category: params.category ?? "general",
          tier:     Number(params.tier) || 1,
        }).select("name").single();
        return data ? `Skill created: "${(data as any).name}"` : null;
      }
      case "complete_ritual": {
        // Fetch ritual to get current streak
        const filter = params.id
          ? sb.from("rituals").select("id,name,streak").eq("id", params.id).eq("user_id", uid)
          : sb.from("rituals").select("id,name,streak").eq("user_id", uid).ilike("name", `%${params.name ?? ""}%`);
        const { data: r } = await filter.limit(1).maybeSingle();
        if (r) {
          const streak = ((r as any).streak ?? 0) + 1;
          await sb.from("rituals").update({ streak, last_completed: new Date().toISOString() }).eq("id", (r as any).id);
          return `Ritual completed: "${(r as any).name}" — streak ${streak}`;
        }
        return "Ritual marked complete";
      }
      case "award_xp": {
        const { data: pr } = await sb.from("profiles").select("xp").eq("id", uid).maybeSingle();
        if (pr) {
          const newXp = (Number((pr as any).xp) || 0) + (Number(params.amount) || 50);
          await sb.from("profiles").update({ xp: newXp }).eq("id", uid);
          return `+${params.amount ?? 50} XP awarded${params.reason ? ` — ${params.reason}` : ""}`;
        }
        return null;
      }
      case "log_expense": {
        await sb.from("mavis_expenses").insert({
          user_id:      uid,
          description:  params.description ?? "Expense",
          amount:       Number(params.amount) || 0,
          category:     params.category ?? "other",
          expense_date: params.date ?? new Date().toISOString().split("T")[0],
        });
        return `Expense logged: ${params.description} ($${params.amount})`;
      }
      case "create_note": {
        await sb.from("mavis_notes").insert({
          user_id: uid,
          title:   params.title ?? "Note",
          content: params.content ?? "",
          tags:    params.tags ?? [],
        }).catch(() => null);
        return `Note created: "${params.title}"`;
      }
      case "create_ally": {
        await sb.from("allies").insert({
          user_id:      uid,
          name:         params.name ?? "Ally",
          relationship: params.relationship ?? "contact",
          notes:        params.notes ?? "",
        }).catch(() => null);
        return `Ally added: ${params.name}`;
      }
      default: {
        // Unrecognized type → queue to approvals for manual review
        await sb.from("approvals").insert({
          user_id:        uid,
          action_type:    type,
          action_summary: `Action from persona/council: ${type}`.slice(0, 255),
          action_payload: params,
          status:         "pending",
        }).catch(() => null);
        return `Action "${type}" queued`;
      }
    }
  } catch (err) {
    console.warn(`[telegram-bot] executeDirectAction ${type} failed:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ── MAVIS context lookup for QUERY_MAVIS blocks ──────────────────────────────
// Called when a persona/council member embeds :::QUERY_MAVIS{...}::: in their reply.
// Searches MAVIS memory, notes, tacit knowledge, and entity conversation histories.
// Returns a 2-4 sentence answer synthesized from retrieved context.
async function queryMavisForContext(question: string, target: string, uid: string): Promise<string> {
  try {
    const targetLower = (target ?? "mavis").toLowerCase().trim();

    // If target is a named persona/council member, fetch their conversation history
    let targetConvoLines = "";
    if (targetLower && targetLower !== "mavis") {
      const [pRes, cRes] = await Promise.all([
        sb.from("personas").select("id, name").eq("user_id", uid).ilike("name", targetLower),
        sb.from("councils").select("id, name").eq("user_id", uid).ilike("name", targetLower),
      ]);
      const personaMatch = (pRes.data ?? []) as any[];
      const councilMatch = (cRes.data ?? []) as any[];

      if (personaMatch.length > 0) {
        const { data: msgs } = await sb.from("persona_conversations")
          .select("role, content, created_at")
          .eq("user_id", uid)
          .eq("persona_id", personaMatch[0].id)
          .order("created_at", { ascending: false })
          .limit(60);
        const reversed = ((msgs ?? []) as any[]).reverse();
        targetConvoLines = `CONVERSATION WITH ${personaMatch[0].name.toUpperCase()} (${reversed.length} messages):\n` +
          reversed.map((m: any) => `${m.role === "user" ? "OPERATOR" : personaMatch[0].name}: ${String(m.content ?? "").slice(0, 400)}`).join("\n");
      } else if (councilMatch.length > 0) {
        const { data: msgs } = await sb.from("council_chat_messages")
          .select("role, content, created_at")
          .eq("user_id", uid)
          .eq("council_member_id", councilMatch[0].id)
          .order("created_at", { ascending: false })
          .limit(60);
        const reversed = ((msgs ?? []) as any[]).reverse();
        targetConvoLines = `CONVERSATION WITH ${councilMatch[0].name.toUpperCase()} (${reversed.length} messages):\n` +
          reversed.map((m: any) => `${m.role === "user" ? "OPERATOR" : councilMatch[0].name}: ${String(m.content ?? "").slice(0, 400)}`).join("\n");
      }
    }

    // Always pull MAVIS memory + notes + tacit for full context
    const [memRes, notesRes, tacitRes] = await Promise.all([
      sb.from("mavis_memory").select("role, content, importance_score")
        .eq("user_id", uid)
        .order("importance_score", { ascending: false })
        .limit(20),
      sb.from("mavis_notes").select("title, content")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(10),
      sb.from("mavis_tacit").select("category, key, value")
        .eq("user_id", uid)
        .limit(15),
    ]);

    const parts: string[] = [];
    if (targetConvoLines) parts.push(targetConvoLines);
    if ((memRes.data ?? []).length > 0) {
      parts.push("MAVIS MEMORY:\n" + (memRes.data as any[]).map((m: any) => `[${m.role}] ${String(m.content ?? "").slice(0, 300)}`).join("\n"));
    }
    if ((notesRes.data ?? []).length > 0) {
      parts.push("NOTES:\n" + (notesRes.data as any[]).map((n: any) => `${n.title}: ${String(n.content ?? "").slice(0, 200)}`).join("\n"));
    }
    if ((tacitRes.data ?? []).length > 0) {
      parts.push("OPERATOR PREFERENCES:\n" + (tacitRes.data as any[]).map((t: any) => `${t.key}: ${t.value}`).join("\n"));
    }

    if (parts.length === 0) return "[MAVIS: No relevant information found in memory.]";

    const context = parts.join("\n\n").slice(0, 5000);
    const answer = await callLLM(
      "gemini-2.0-flash",
      "You are MAVIS's internal retrieval system. Answer the question in 2-4 sentences using ONLY the provided context. If the answer isn't in the context, say so briefly. Be direct and factual.",
      [{ role: "user", content: `CONTEXT:\n${context}\n\nQUESTION: ${question}` }],
      250,
    );
    return `[MAVIS: ${(answer ?? "No relevant information found.").trim()}]`;
  } catch {
    return "[MAVIS: Unable to retrieve information at this time.]";
  }
}

// Parse PROPOSE_ACTION and PROPOSE_MAVIS blocks from a raw LLM reply.
// Returns the stripped visible text + confirmation lines to append.
async function parseAndHandleProposals(
  rawReply: string,
  uid: string,
  chatId: string | number,
  charName: string,
): Promise<string> {
  const ACTION_RE = /:::PROPOSE_ACTION(\{[\s\S]*?\}):::/g;
  const MAVIS_RE  = /:::PROPOSE_MAVIS(\{[\s\S]*?\}):::/g;
  const QUERY_RE  = /:::QUERY_MAVIS(\{[\s\S]*?\}):::/g;

  const actionResults: string[] = [];
  const mavisProposals: Array<{ type: string; summary: string; details: string; payload: Record<string, any> }> = [];

  // ── Resolve QUERY_MAVIS blocks inline ───────────────────────────────────────
  // Replace each :::QUERY_MAVIS{...}::: with the actual MAVIS answer so it
  // appears naturally in the persona's text instead of a raw block.
  let match: RegExpExecArray | null;
  let workingReply = rawReply;
  const queryBlocks: Array<{ full: string; answer: string }> = [];
  QUERY_RE.lastIndex = 0;
  while ((match = QUERY_RE.exec(rawReply)) !== null) {
    try {
      const { question, target } = JSON.parse(match[1]);
      if (question) {
        const answer = await queryMavisForContext(String(question), String(target ?? "mavis"), uid);
        queryBlocks.push({ full: match[0], answer });
      }
    } catch { /* malformed block — skip */ }
  }
  for (const { full, answer } of queryBlocks) {
    workingReply = workingReply.replace(full, answer);
  }

  // Collect direct actions
  while ((match = ACTION_RE.exec(workingReply)) !== null) {
    try {
      const { type, params } = JSON.parse(match[1]);
      if (type && params) {
        const result = await executeDirectAction(type, params, uid);
        if (result) actionResults.push(result);
      }
    } catch {
      // malformed block — skip
    }
  }

  // Collect MAVIS proposals
  MAVIS_RE.lastIndex = 0;
  while ((match = MAVIS_RE.exec(workingReply)) !== null) {
    try {
      const prop = JSON.parse(match[1]);
      mavisProposals.push({
        type:    prop.type    ?? "other",
        summary: prop.summary ?? prop.details?.slice(0, 80) ?? "Proposal",
        details: prop.details ?? prop.summary ?? "",
        payload: prop.payload ?? {},
      });
    } catch {
      // malformed block — skip
    }
  }

  // Strip action/proposal blocks from visible text (QUERY_MAVIS already replaced inline)
  ACTION_RE.lastIndex = 0;
  MAVIS_RE.lastIndex = 0;
  let visible = workingReply
    .replace(ACTION_RE, "")
    .replace(MAVIS_RE, "")
    .trim();

  // Queue MAVIS proposals
  if (mavisProposals.length > 0) {
    const rows = mavisProposals.map((p) => ({
      user_id:        uid,
      action_type:    p.type,
      action_summary: `[${charName}] ${p.summary}`.slice(0, 255),
      action_payload: { ...p.payload, details: p.details, proposed_by: charName },
      status:         "pending",
      proposed_by:    charName,
    }));
    await sb.from("approvals").insert(rows).catch(() => null);
  }

  // Append action confirmations to the visible reply
  if (actionResults.length > 0) {
    visible += `\n\n_Actions: ${actionResults.join(" · ")}_`;
  }
  if (mavisProposals.length > 0) {
    const summaries = mavisProposals.map((p) => p.summary).join("; ");
    visible += `\n\n_Flagged for MAVIS: ${summaries}_`;
  }

  return visible || rawReply;
}

async function resolveCouncilOwnerUid(uid: string): Promise<string> {
  if (uid) {
    const { data: own } = await sb.from("councils").select("user_id").eq("user_id", uid).limit(1);
    if (own && (own as any[]).length > 0) return uid;
  }
  const { data: any1 } = await sb.from("councils").select("user_id").limit(1);
  if (any1 && (any1 as any[]).length > 0) return String((any1 as any[])[0].user_id);
  return uid;
}

// ─────────────────────────────────────────────────────────────
// INTENT CLASSIFICATION
// ─────────────────────────────────────────────────────────────

type Intent = "help" | "quests" | "revenue" | "tasks" | "actions" | "content_machine" | "speak"
            | "list_personas" | "switch_persona" | "reset_persona"
            | "list_council" | "chat";
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

  // Persona / council switching
  if (/^\/?(personas?(\s+list)?|characters?(\s+list)?)$/i.test(lower))
    return { intent: "list_personas", params: {} };
  if (/^\/?(council(s|board|members?)?(\s+list)?)$/i.test(lower))
    return { intent: "list_council", params: {} };
  if (/^\/?(mavis|reset(\s+(persona|council))?|exit(\s+(persona|council))?|back\s+to\s+mavis)$/i.test(lower))
    return { intent: "reset_persona", params: {} };
  const personaMatch = text.match(/^\/?(persona|as|speak[- ]as|be|character|council\s+member)\s+(.+)$/i);
  if (personaMatch)
    return { intent: "switch_persona", params: { name: personaMatch[2].trim() } };

  // Bare /name shortcut — e.g. /lilu, /marcus (tries persona then council)
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
    `*Personas & Council:*\n` +
    `🎭 \`/personas\` — list your personas\n` +
    `🏛️ \`/council\` — list your council members\n` +
    `🎭 \`/as [name]\` or \`/[name]\` — switch to a persona or council member\n` +
    `✨ \`/mavis\` — return to MAVIS\n\n` +
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
    // Try council members as fallback before giving up
    const switched = await handleSwitchCouncil(chatId, uid, name);
    if (!switched) {
      await send(chatId,
        `🎭 No persona or council member matching "*${name}*".\n\nUse \`/personas\` or \`/council\` to see available names.`,
      );
    }
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
    model:         String(p.model ?? "claude-haiku-4-5-20251001") || "claude-haiku-4-5-20251001",
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
  await setActiveCouncil(uid, null);
  await send(chatId, `✨ *MAVIS online.* Session ended.`);
}

// ─────────────────────────────────────────────────────────────
// COUNCIL HANDLERS
// ─────────────────────────────────────────────────────────────

async function handleListCouncil(chatId: string | number, uid: string) {
  const effectiveUid = await resolveCouncilOwnerUid(uid);
  const { data: members } = await sb
    .from("councils")
    .select("id, name, role, specialty, class")
    .eq("user_id", effectiveUid)
    .order("name", { ascending: true })
    .limit(30);

  if (!members || (members as any[]).length === 0) {
    await send(chatId,
      `🏛️ No council members found.\n\nAdd members in the Vantara app → Council Board tab.\n\n_(UID: \`${effectiveUid}\`)_`,
    );
    return;
  }

  const active = await getActiveCouncil(uid);
  const lines = (members as any[]).map((m) => {
    const marker = active?.id === m.id ? " ✅" : "";
    const spec = m.specialty ? ` · ${m.specialty}` : "";
    return `• *${m.name}*${marker} — ${m.role ?? "Member"}${spec}`;
  });

  await send(chatId,
    `🏛️ *Your Council (${lines.length})*\n\n${lines.join("\n")}\n\n` +
    `Switch: \`/as [name]\` or \`/[name]\`   Reset: \`/mavis\``,
  );
}

async function handleSwitchCouncil(chatId: string | number, uid: string, name: string): Promise<boolean> {
  const effectiveUid = await resolveCouncilOwnerUid(uid);
  // NOTE: councils table has no "model" column — omit it to avoid PostgREST errors
  const { data: members } = await sb
    .from("councils")
    .select("id, name, role, specialty, personality_prompt, notes")
    .eq("user_id", effectiveUid)
    .ilike("name", `%${name}%`)
    .limit(5);

  if (!members || (members as any[]).length === 0) return false;

  const wanted = normalizePersonaName(name);
  const exact = (members as any[]).find((m) => normalizePersonaName(String(m.name ?? "")) === wanted);
  const m: any = exact ?? (members as any[])[0];

  const session: CouncilSession = {
    id:               String(m.id ?? ""),
    name:             String(m.name ?? ""),
    role:             String(m.role ?? ""),
    specialty:        String(m.specialty ?? ""),
    personality_prompt: String(m.personality_prompt ?? ""),
    notes:            String(m.notes ?? ""),
    model:            "claude-haiku-4-5-20251001",
  };

  await setActiveCouncil(uid, session);
  await setActivePersona(uid, null); // mutually exclusive

  await send(chatId,
    `🏛️ *Now speaking with ${m.name}*${m.role ? ` — ${m.role}` : ""}${m.specialty ? ` (${m.specialty})` : ""}\n\n` +
    `Send any message to chat with ${m.name}.\n` +
    `Send \`/mavis\` to return to MAVIS.`,
  );
  return true;
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

  // ── Council member mode ────────────────────────────────────────────────────
  const activeCouncil = await getActiveCouncil(uid);
  if (activeCouncil) {
    try {
      // Load app context and conversation history in parallel
      const [appCtx, councilHistRes] = await Promise.all([
        loadAppContext(uid),
        sb.from("council_chat_messages")
          .select("role, content")
          .eq("council_member_id", activeCouncil.id)
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(16),
      ]);

      const councilSystem = buildCouncilSystemPrompt(activeCouncil, appCtx);
      const recentHistory: ChatMessage[] = ((councilHistRes.data ?? []).reverse() as any[]).map((m: any) => ({
        role:    m.role as "user" | "assistant",
        content: String(m.content ?? ""),
      }));
      const msgs: ChatMessage[] = [...recentHistory, { role: "user", content: text }];
      const rawReply = await callLLM(activeCouncil.model || "claude-haiku-4-5-20251001", councilSystem, msgs, 1200);

      if (rawReply) {
        const reply = await parseAndHandleProposals(rawReply, uid, chatId, activeCouncil.name);
        await send(chatId, reply);
        await Promise.resolve(sb.from("council_chat_messages").insert([
          { council_member_id: activeCouncil.id, user_id: uid, role: "user",      content: text     },
          { council_member_id: activeCouncil.id, user_id: uid, role: "assistant", content: rawReply },
        ])).catch((err) => console.warn("[telegram-bot] council_chat_messages write failed", err));
      } else {
        await send(chatId, `⚠️ ${activeCouncil.name} is unavailable right now. Try again.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await send(chatId, `⚠️ Council error: ${msg.slice(0, 200)}`);
    }
    return;
  }

  // ── Persona mode: bypass mavis-agent, talk directly as the character ──────
  const activePersona = await getActivePersona(uid);
  if (activePersona) {
    try {
      // Load app context and conversation history in parallel
      const [appCtx, personaHistRes] = await Promise.all([
        loadAppContext(uid),
        sb.from("persona_conversations")
          .select("role, content")
          .eq("persona_id", activePersona.id)
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(16),
      ]);

      const personaSystem = buildPersonaSystemPrompt(activePersona, appCtx);
      const recentHistory: ChatMessage[] = ((personaHistRes.data ?? []).reverse() as any[]).map((m: any) => ({
        role:    m.role as "user" | "assistant",
        content: String(m.content ?? ""),
      }));

      const msgs: ChatMessage[] = [...recentHistory, { role: "user", content: text }];
      const rawReply = await callLLM(activePersona.model || "claude-haiku-4-5-20251001", personaSystem, msgs, 1200);

      if (rawReply) {
        const reply = await parseAndHandleProposals(rawReply, uid, chatId, activePersona.name);
        await send(chatId, reply);
        // Write raw reply to persona_conversations so the web PersonaChat thread stays clean
        await Promise.resolve(sb.from("persona_conversations").insert([
          { persona_id: activePersona.id, user_id: uid, role: "user",      content: text     },
          { persona_id: activePersona.id, user_id: uid, role: "assistant", content: rawReply },
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
        case "list_council":    await handleListCouncil(chatId, uid); break;
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
