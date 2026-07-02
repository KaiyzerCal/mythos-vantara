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
// VIDEO ANALYSIS (Gemini 2.5 Flash — full visual + audio)
// ─────────────────────────────────────────────────────────────

async function analyzeVideoWithGemini(
  fileId: string,
  mimeType: string,
  fileName: string,
  caption?: string,
): Promise<string> {
  const geminiKey = GEMINI_KEY;
  if (!geminiKey) throw new Error("GEMINI_API_KEY not configured");
  const botToken = BOT_TOKEN;

  // 1. Get file path from Telegram
  const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!fileRes.ok) throw new Error(`getFile failed: ${fileRes.status}`);
  const fileData = await fileRes.json();
  const filePath = fileData.result?.file_path;
  if (!filePath) throw new Error("No file_path from Telegram");

  // 2. Download video bytes
  const dlRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!dlRes.ok) throw new Error(`Download failed: ${dlRes.status}`);
  const videoData = new Uint8Array(await dlRes.arrayBuffer());

  // 3. Upload to Gemini Files API (multipart)
  const boundary = "tg_video_boundary";
  const displayName = fileName || filePath.split("/").pop() || "video.mp4";
  const metaJson = JSON.stringify({ file: { display_name: displayName } });
  const metaPart  = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n`;
  const dataPart  = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const closing   = `\r\n--${boundary}--`;
  const enc = new TextEncoder();
  const metaBytes  = enc.encode(metaPart);
  const dataHeader = enc.encode(dataPart);
  const closeBytes = enc.encode(closing);
  const uploadBody = new Uint8Array(metaBytes.length + dataHeader.length + videoData.length + closeBytes.length);
  uploadBody.set(metaBytes, 0);
  uploadBody.set(dataHeader, metaBytes.length);
  uploadBody.set(videoData, metaBytes.length + dataHeader.length);
  uploadBody.set(closeBytes, metaBytes.length + dataHeader.length + videoData.length);

  const uploadRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart&key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: uploadBody,
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!uploadRes.ok) throw new Error(`Gemini upload ${uploadRes.status}: ${(await uploadRes.text()).slice(0, 200)}`);
  const uploaded = await uploadRes.json();
  const fileUri        = String(uploaded.file?.uri ?? "");
  const geminiFileName = String(uploaded.file?.name ?? "");

  // 4. Poll until file state is ACTIVE (Gemini processes video server-side)
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const statusRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${geminiFileName}?key=${geminiKey}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (statusRes.ok) {
      const s = await statusRes.json();
      if (s.state === "ACTIVE") break;
      if (s.state === "FAILED") throw new Error("Gemini video processing failed");
    }
    if (i === 39) throw new Error("Gemini video processing timed out");
  }

  // 5. Analyze with Gemini 2.5 Flash
  const prompt = caption
    ? `The user says: "${caption}"\n\nAnalyze this video with that context. Also provide a general description of what's happening visually and any audio/speech you can detect.`
    : `Analyze this video completely:\n\n1. VISUAL (with timestamps MM:SS): What is happening scene by scene? People, actions, text on screen, objects.\n2. AUDIO: Transcribe any speech verbatim. Note [music], [silence], etc.\n3. KEY MOMENTS: 3-5 most notable moments with timestamps.\n4. SUMMARY: One paragraph overview.`;

  const analyzeRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [
          { file_data: { mime_type: mimeType, file_uri: fileUri } },
          { text: prompt },
        ]}],
        generationConfig: { maxOutputTokens: 8192 },
      }),
      signal: AbortSignal.timeout(180_000),
    },
  );

  // Cleanup uploaded file from Gemini (fire and forget)
  fetch(
    `https://generativelanguage.googleapis.com/v1beta/${geminiFileName}?key=${geminiKey}`,
    { method: "DELETE" },
  ).catch(() => {});

  if (!analyzeRes.ok) throw new Error(`Gemini analysis ${analyzeRes.status}: ${(await analyzeRes.text()).slice(0, 200)}`);
  const result = await analyzeRes.json();
  const analysisParts: any[] = result.candidates?.[0]?.content?.parts ?? [];
  const analysisText = analysisParts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join("").trim();
  if (!analysisText) throw new Error("Gemini returned empty analysis");
  return analysisText;
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
  id:            string;
  name:          string;
  role:          string;
  archetype:     string;
  system_prompt: string;
  bio:           string;
  lore:          string[];
  adjectives:    string[];
  topics:        string[];
  model:         string;
  timezone?:     string;  // persona's own timezone (if they "live" somewhere specific)
  agent_folders?: Record<string, string>;  // 7-folder framework content
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

// ── Temporal block — timezone-aware, used by all entity prompt builders ──
function buildTemporalBlock(operatorTz = "UTC", entityTz?: string): string {
  const now = new Date();
  function fmt(tz: string): string {
    try {
      const d = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: tz });
      const t = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short", timeZone: tz });
      return `${d}, ${t} [${tz}]`;
    } catch {
      return now.toUTCString();
    }
  }
  const lines: string[] = [];
  if (entityTz && entityTz !== operatorTz) {
    lines.push(`YOUR LOCAL TIME: ${fmt(entityTz)}`);
    lines.push(`OPERATOR LOCAL: ${fmt(operatorTz)}`);
  } else {
    lines.push(`LOCAL: ${fmt(operatorTz)}`);
  }
  lines.push(`ISO/UTC: ${now.toISOString()}`);
  return `═══ TEMPORAL CONTEXT ═══\n${lines.join("\n")}\nAlways reference the local time above when dates/times come up. Never show UTC unless asked.\n═══ END TEMPORAL CONTEXT ═══`;
}

function buildPersonaSystemPrompt(p: PersonaSession, appCtx = "", operatorTz = "UTC"): string {
  const parts: string[] = [];
  parts.push(`You are ${p.name}${p.role ? `, a ${p.role}` : ""}.`);
  if (p.archetype?.trim())     parts.push(`\nArchetype: ${p.archetype.trim()}`);
  if (p.bio?.trim())           parts.push(`\nBackground: ${p.bio.trim()}`);
  if (p.lore?.length)          parts.push(`\nLore:\n${p.lore.map(l => `- ${l}`).join("\n")}`);
  if (p.adjectives?.length)    parts.push(`\nYour personality: ${p.adjectives.join(", ")}`);
  if (p.topics?.length)        parts.push(`\nYour natural topics: ${p.topics.join(", ")}`);
  if (p.system_prompt?.trim()) parts.push(`\n${p.system_prompt.trim()}`);
  // Agent framework content (all supported folder keys)
  const af = p.agent_folders ?? {};
  if (af.identity)      parts.push(`\n\n═══ IDENTITY (01) ═══\n${af.identity}\n═══ END IDENTITY ═══`);
  if (af.memory_notes)  parts.push(`\n\n═══ MEMORY NOTES (02) ═══\n${af.memory_notes}\n═══ END MEMORY NOTES ═══`);
  if (af.prompts)       parts.push(`\n\n═══ PROMPT LIBRARY (04) ═══\n${af.prompts}\n═══ END PROMPT LIBRARY ═══`);
  if (af.knowledge)     parts.push(`\n\n═══ KNOWLEDGE (06) ═══\n${af.knowledge}\n═══ END KNOWLEDGE ═══`);
  if (af.references)    parts.push(`\n\n═══ REFERENCES (06) ═══\n${af.references}\n═══ END REFERENCES ═══`);
  if (af.library)       parts.push(`\n\n═══ LIBRARY (07) ═══\n${af.library}\n═══ END LIBRARY ═══`);
  if (af.operations)    parts.push(`\n\n═══ OPERATIONS (09) ═══\n${af.operations}\n═══ END OPERATIONS ═══`);
  parts.push(`\nStay fully in character as ${p.name}. Do not refer to yourself as MAVIS or as an AI unless directly asked.`);
  parts.push(`\n\nYou exist alongside other AI personas and council members in the operator's ecosystem. When you genuinely need another entity's perspective to give a better answer, you may consult them using :::CONSULT_ENTITY::: (see ACTION MECHANICS below). Only use this when it meaningfully improves your response — not as a reflex.`);
  parts.push(`\n\nWHAT YOU HAVE ACCESS TO:\nYou exist inside CODEXOS — a full AI operating system. You have context about everything in this person's life: quests, goals, journal, vault, skills, health, finance, relationships, and all active personas. Reference this naturally in conversation.\nYou can silently propose actions using hidden blocks (never acknowledge them aloud):\n:::PROPOSE_ACTION{"type":"recall_memory","params":{"query":"..."}}:::\n:::PROPOSE_ACTION{"type":"create_journal","params":{"title":"...","content":"..."}}:::\n:::PROPOSE_ACTION{"type":"create_quest","params":{"title":"...","type":"daily","xp_reward":50}}:::\n:::PROPOSE_ACTION{"type":"award_xp","params":{"amount":25,"reason":"..."}}:::\n:::PROPOSE_ACTION{"type":"add_standing_order","params":{"order_text":"..."}}:::\n:::PROPOSE_ACTION{"type":"get_biometric_state","params":{}}}:::\nUse them when the moment calls for it — never explain or acknowledge the mechanics.\n:::HIDDEN_ACTIONS_ALLOWED:::`);
  // Temporal context — uses persona's own timezone if set
  parts.push(`\n\n${buildTemporalBlock(operatorTz, p.timezone)}`);
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
  timezone?:        string;
  agent_folders?:   Record<string, string>;
}

const COUNCIL_STATE_PREFIX = "telegram-council-state-";

// ─────────────────────────────────────────────────────────────
// AGENCY SESSION  (active specialist from The Agency)
// ─────────────────────────────────────────────────────────────

interface AgencySession {
  agent_id:   string;   // "division/file.md"
  name:       string;   // display name
  division:   string;
  raw_url:    string;
  spec:       string;   // full markdown spec
}

const AGENCY_STATE_PREFIX = "telegram-agency-state-";

async function getActiveAgency(uid: string): Promise<AgencySession | null> {
  try {
    const { data } = await sb.from("mavis_memory")
      .select("content")
      .eq("user_id", uid)
      .eq("session_id", `${AGENCY_STATE_PREFIX}${uid}`)
      .eq("role", "system")
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data?.content) return null;
    return JSON.parse(String(data.content)) as AgencySession;
  } catch {
    return null;
  }
}

async function setActiveAgency(uid: string, session: AgencySession | null): Promise<void> {
  try {
    await sb.from("mavis_memory")
      .delete()
      .eq("user_id", uid)
      .eq("session_id", `${AGENCY_STATE_PREFIX}${uid}`)
      .eq("role", "system");
    if (session) {
      await sb.from("mavis_memory").insert({
        user_id:          uid,
        session_id:       `${AGENCY_STATE_PREFIX}${uid}`,
        role:             "system",
        content:          JSON.stringify(session),
        timestamp:        Date.now(),
        importance_score: 1,
        consolidated:     true,
      });
      // Also sync to persistent DB table so the app reflects Telegram activations
      await sb.from("mavis_active_agency_specialists").upsert({
        user_id:      uid,
        agent_id:     session.agent_id,
        agent_name:   session.name,
        division:     session.division,
        raw_url:      session.raw_url,
        spec_content: session.spec,
        activated_at: new Date().toISOString(),
      }, { onConflict: "user_id" }).catch(() => null);
    } else {
      await sb.from("mavis_active_agency_specialists").delete().eq("user_id", uid).catch(() => null);
    }
  } catch { /* non-fatal */ }
}

// ── Compact agent manifest for routing (division → [file, ...]) ──────────────
const AGENCY_BASE_URL = "https://raw.githubusercontent.com/KaiyzerCal/agency-agents/main";

const AGENCY_MANIFEST: Record<string, string[]> = {
  "engineering": [
    "engineering-ai-data-remediation-engineer","engineering-ai-engineer","engineering-autonomous-optimization-architect",
    "engineering-backend-architect","engineering-cms-developer","engineering-code-reviewer","engineering-codebase-onboarding-engineer",
    "engineering-data-engineer","engineering-database-optimizer","engineering-devops-automator","engineering-drupal-shopping-cart",
    "engineering-email-intelligence-engineer","engineering-embedded-firmware-engineer","engineering-feishu-integration-developer",
    "engineering-filament-optimization-specialist","engineering-frontend-developer","engineering-git-workflow-master",
    "engineering-incident-response-commander","engineering-it-service-manager","engineering-minimal-change-engineer",
    "engineering-mobile-app-builder","engineering-multi-agent-systems-architect","engineering-network-engineer",
    "engineering-orgscript-engineer","engineering-prompt-engineer","engineering-rapid-prototyper","engineering-senior-developer",
    "engineering-software-architect","engineering-solidity-smart-contract-engineer","engineering-sre","engineering-technical-writer",
    "engineering-voice-ai-integration-engineer","engineering-wechat-mini-program-developer","engineering-wordpress-shopping-cart",
  ],
  "design": [
    "design-brand-guardian","design-image-prompt-engineer","design-inclusive-visuals-specialist","design-persona-walkthrough",
    "design-ui-designer","design-ux-architect","design-ux-researcher","design-visual-storyteller","design-whimsy-injector",
  ],
  "marketing": [
    "marketing-aeo-foundations","marketing-agentic-search-optimizer","marketing-ai-citation-strategist","marketing-app-store-optimizer",
    "marketing-baidu-seo-specialist","marketing-bilibili-content-strategist","marketing-book-co-author","marketing-carousel-growth-engine",
    "marketing-china-ecommerce-operator","marketing-china-market-localization-strategist","marketing-content-creator",
    "marketing-cross-border-ecommerce","marketing-douyin-strategist","marketing-email-strategist","marketing-global-podcast-strategist",
    "marketing-growth-hacker","marketing-instagram-curator","marketing-kuaishou-strategist","marketing-linkedin-content-creator",
    "marketing-livestream-commerce-coach","marketing-multi-platform-publisher","marketing-podcast-strategist",
    "marketing-pr-communications-manager","marketing-private-domain-operator","marketing-reddit-community-builder",
    "marketing-seo-specialist","marketing-short-video-editing-coach","marketing-social-media-strategist","marketing-tiktok-strategist",
    "marketing-twitter-engager","marketing-video-optimization-specialist","marketing-wechat-official-account","marketing-weibo-strategist",
    "marketing-x-twitter-intelligence-analyst","marketing-xiaohongshu-specialist","marketing-zhihu-strategist",
  ],
  "sales": [
    "sales-account-strategist","sales-coach","sales-deal-strategist","sales-discovery-coach","sales-engineer",
    "sales-offer-lead-gen-strategist","sales-outbound-strategist","sales-pipeline-analyst","sales-proposal-strategist",
  ],
  "product": [
    "product-behavioral-nudge-engine","product-feedback-synthesizer","product-manager","product-sprint-prioritizer","product-trend-researcher",
  ],
  "project-management": [
    "project-management-experiment-tracker","project-management-jira-workflow-steward","project-management-meeting-notes-specialist",
    "project-management-project-shepherd","project-management-studio-operations","project-management-studio-producer","project-manager-senior",
  ],
  "testing": [
    "testing-accessibility-auditor","testing-api-tester","testing-evidence-collector","testing-performance-benchmarker",
    "testing-reality-checker","testing-test-results-analyzer","testing-tool-evaluator","testing-workflow-optimizer",
  ],
  "security": [
    "security-appsec-engineer","security-architect","security-blockchain-security-auditor","security-cloud-security-architect",
    "security-compliance-auditor","security-incident-responder","security-penetration-tester","security-senior-secops",
    "security-threat-detection-engineer","security-threat-intelligence-analyst",
  ],
  "support": [
    "support-analytics-reporter","support-executive-summary-generator","support-finance-tracker",
    "support-infrastructure-maintainer","support-legal-compliance-checker","support-support-responder",
  ],
  "spatial-computing": [
    "macos-spatial-metal-engineer","terminal-integration-specialist","visionos-spatial-engineer",
    "xr-cockpit-interaction-specialist","xr-immersive-developer","xr-interface-architect",
  ],
  "game-development": [
    "game-audio-engineer","game-designer","level-designer","narrative-designer","technical-artist",
  ],
  "academic": [
    "academic-anthropologist","academic-geographer","academic-historian","academic-narratologist","academic-psychologist",
  ],
  "gis": [
    "gis-3d-scene-developer","gis-analyst","gis-bim-specialist","gis-cartography-designer","gis-drone-reality-mapping",
    "gis-geoai-ml-engineer","gis-geoprocessing-specialist","gis-qa-engineer","gis-solution-engineer",
    "gis-spatial-data-engineer","gis-spatial-data-scientist","gis-technical-consultant","gis-web-gis-developer",
  ],
  "finance": [
    "finance-bookkeeper-controller","finance-financial-analyst","finance-fpa-analyst","finance-investment-researcher","finance-tax-strategist",
  ],
  "specialized": [
    "accounts-payable-agent","agentic-identity-trust","agents-orchestrator","automation-governance-architect","business-strategist",
    "change-management-consultant","chief-financial-officer","corporate-training-designer","customer-service","customer-success-manager",
    "data-consolidation-agent","data-privacy-officer","esg-sustainability-officer","government-digital-presales-consultant","grant-writer",
    "healthcare-customer-service","healthcare-marketing-compliance","hospitality-guest-services","hr-onboarding","identity-graph-operator",
    "language-translator","legal-billing-time-tracking","legal-client-intake","legal-document-review","loan-officer-assistant",
    "lsp-index-engineer","ma-integration-manager","medical-billing-coding-specialist","operations-manager","organizational-psychologist",
    "personal-growth-mentor","real-estate-buyer-seller","recruitment-specialist","report-distribution-agent","retail-customer-returns",
    "sales-data-extraction-agent","sales-outreach","specialized-chief-of-staff","specialized-civil-engineer",
    "specialized-cultural-intelligence-strategist","specialized-developer-advocate","specialized-document-generator",
    "specialized-french-consulting-market","specialized-korean-business-navigator","specialized-mcp-builder","specialized-model-qa",
    "specialized-pricing-analyst","specialized-salesforce-architect","specialized-strategy-duel-agent","specialized-workflow-architect",
    "study-abroad-advisor","supply-chain-strategist","zk-steward",
  ],
};

const AGENCY_DIV_KEYWORDS: Record<string, string[]> = {
  "engineering":         ["code","build","develop","api","backend","frontend","database","server","deploy","docker","kubernetes","architecture","algorithm","bug","debug","typescript","python","javascript","rust","go","java","sql","git","devops","pipeline","infrastructure","cloud","aws","azure","gcp","terraform","cicd","engineer","developer","programmer"],
  "design":              ["design","ui","ux","interface","wireframe","prototype","figma","color","typography","layout","visual","branding","logo","icon","mockup","aesthetic","illustration","graphic","accessibility","designer"],
  "marketing":           ["market","campaign","seo","content","social media","email marketing","brand","growth","conversion","funnel","audience","engagement","viral","copywriting","ad","influencer","ppc","newsletter","launch","pr","positioning","tiktok","instagram","linkedin","twitter","youtube","podcast"],
  "sales":               ["sales","prospect","lead","deal","close","crm","outreach","pitch","proposal","negotiation","quota","revenue","customer acquisition","discovery","cold email","pipeline","objection","close deals"],
  "product":             ["product","roadmap","feature","user story","backlog","sprint","mvp","requirement","specification","prioritize","stakeholder","release","prd","product manager"],
  "project-management":  ["project","timeline","milestone","deadline","resource","planning","schedule","risk","scope","budget","gantt","kanban","agile","scrum","task management","deliverable","project manager"],
  "testing":             ["test","qa","quality assurance","bug report","automation","selenium","jest","unit test","integration test","e2e","regression","performance test","load test","cypress","playwright"],
  "security":            ["security","vulnerability","penetration test","exploit","threat","authentication","authorization","encryption","firewall","audit","compliance","hack","malware","phishing","soc","siem","red team","blue team","incident response","cybersecurity"],
  "support":             ["support","help","customer service","ticket","documentation","faq","troubleshoot","onboard","tutorial","user guide","knowledge base","helpdesk","sla"],
  "spatial-computing":   ["ar","vr","xr","augmented reality","virtual reality","mixed reality","spatial","immersive","metaverse","unity","unreal","3d","avatar","haptic","hololens","vision pro","webxr"],
  "game-development":    ["game","gameplay","level design","character","mechanic","sprite","animation","physics","shader","multiplayer","loot","inventory","quest design","game design","rpg","indie game"],
  "academic":            ["research","paper","study","thesis","dissertation","citation","academic","literature review","methodology","hypothesis","peer review","journal","bibliography","scholarly"],
  "gis":                 ["gis","geospatial","map","coordinate","latitude","longitude","spatial analysis","shapefile","satellite","terrain","geography","cartography","gdal","qgis","arcgis","mapping","remote sensing"],
  "finance":             ["finance","investment","portfolio","stock","crypto","budget","profit","loss","valuation","financial model","dcf","roi","cash flow","accounting","tax","hedge","trading","ipo","venture capital"],
  "specialized":         ["strategy","consulting","innovation","ai","machine learning","nlp","data science","neural network","automation","workflow","integration","mcp","agent","cfo","chief","operations","hr","legal","compliance","healthcare","hospitality"],
};

function agentToName(slug: string): string {
  const ACRONYMS = new Set(["ai","ml","ui","ux","xr","gis","bim","sre","cms","seo","pr","hr","iot","sdk","api","qa","ma","fpa","esg","lsp","zk","mcp","cfo","crm","ar","vr","visionos","wechat","tiktok"]);
  return slug.split("-").map(w => ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function agencyClassifyDivision(task: string): string {
  const lower = task.toLowerCase();
  let bestDiv = "specialized";
  let bestScore = 0;
  for (const [divId, keywords] of Object.entries(AGENCY_DIV_KEYWORDS)) {
    const score = keywords.filter(kw => lower.includes(kw)).length;
    if (score > bestScore) { bestScore = score; bestDiv = divId; }
  }
  return bestDiv;
}

function agencyFindBest(task: string): { agentId: string; name: string; division: string; rawUrl: string } | null {
  const divId = agencyClassifyDivision(task);
  const files = AGENCY_MANIFEST[divId] ?? [];
  if (!files.length) return null;
  const lower = task.toLowerCase();
  const scored = files.map(slug => ({
    slug,
    score: slug.split("-").filter(w => w.length > 3 && lower.includes(w)).length,
  }));
  scored.sort((a, b) => b.score - a.score);
  const slug = scored[0]?.slug ?? files[0];
  const file = `${slug}.md`;
  return {
    agentId:  `${divId}/${file}`,
    name:     agentToName(slug),
    division: divId,
    rawUrl:   `${AGENCY_BASE_URL}/${divId}/${file}`,
  };
}

function buildAgencySystemPrompt(session: AgencySession, appCtx = "", operatorTz = "UTC"): string {
  const divLabel = session.division.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const parts: string[] = [
    `You are ${session.name}, a specialist from The Agency — ${divLabel} Division.`,
    `\nYou exist inside CODEXOS, the operator's personal AI operating system. You have full context about their life, goals, systems, and businesses.`,
    `\nHere is your specialist definition:\n\n${session.spec.slice(0, 8000)}`,
    `\n\nStay fully in character as ${session.name}. Apply your specialist expertise to every response. You can still propose actions using hidden blocks.`,
  ];
  parts.push(`\n\n${buildTemporalBlock(operatorTz)}`);
  if (appCtx) parts.push(`\n\n${appCtx}`);
  parts.push(`\n\n${ACTION_MECHANIC_PROMPT}`);
  return parts.join("");
}

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

function buildCouncilSystemPrompt(c: CouncilSession, appCtx = "", operatorTz = "UTC"): string {
  const parts: string[] = [];
  parts.push(`You are ${c.name}${c.role ? `, ${c.role}` : ""}${c.specialty ? ` specialising in ${c.specialty}` : ""}.`);
  if (c.notes?.trim())              parts.push(`\nBackground: ${c.notes.trim()}`);
  if (c.personality_prompt?.trim()) parts.push(`\n${c.personality_prompt.trim()}`);
  // Agent framework content (all supported folder keys)
  const af = c.agent_folders ?? {};
  if (af.identity)      parts.push(`\n\n═══ IDENTITY (01) ═══\n${af.identity}\n═══ END IDENTITY ═══`);
  if (af.memory_notes)  parts.push(`\n\n═══ MEMORY NOTES (02) ═══\n${af.memory_notes}\n═══ END MEMORY NOTES ═══`);
  if (af.prompts)       parts.push(`\n\n═══ PROMPT LIBRARY (04) ═══\n${af.prompts}\n═══ END PROMPT LIBRARY ═══`);
  if (af.knowledge)     parts.push(`\n\n═══ KNOWLEDGE (06) ═══\n${af.knowledge}\n═══ END KNOWLEDGE ═══`);
  if (af.references)    parts.push(`\n\n═══ REFERENCES (06) ═══\n${af.references}\n═══ END REFERENCES ═══`);
  if (af.library)       parts.push(`\n\n═══ LIBRARY (07) ═══\n${af.library}\n═══ END LIBRARY ═══`);
  if (af.operations)    parts.push(`\n\n═══ OPERATIONS (09) ═══\n${af.operations}\n═══ END OPERATIONS ═══`);
  parts.push(`\nYou are a council member advising the operator. Speak directly from your expertise. Be concise and strategic. Do not refer to yourself as MAVIS or as a generic AI.`);
  parts.push(`\n\nYou exist alongside other AI personas and council members. When you need another entity's unique expertise to give a stronger answer, use :::CONSULT_ENTITY::: (see ACTION MECHANICS below). Use this sparingly and only when it genuinely adds value.`);
  parts.push(`\n\nWHAT YOU CAN TRIGGER (propose these silently — never acknowledge aloud):\n:::PROPOSE_ACTION{"type":"recall_memory","params":{"query":"..."}}:::\n:::PROPOSE_ACTION{"type":"get_biometric_state","params":{}}}:::\n:::PROPOSE_ACTION{"type":"get_standing_orders","params":{}}:::\n:::PROPOSE_ACTION{"type":"add_standing_order","params":{"order_text":"..."}}:::\n:::PROPOSE_ACTION{"type":"list_skills","params":{}}:::\n:::PROPOSE_ACTION{"type":"get_pending_reviews","params":{}}:::\nYou can also propose: create_quest, complete_quest, create_task, create_journal, create_vault, create_note, create_skill, award_xp, update_profile, create_ally, create_inventory_item, create_ranking, update_energy.\n:::HIDDEN_ACTIONS_ALLOWED:::`);
  // Temporal context — uses council member's own timezone if set
  parts.push(`\n\n${buildTemporalBlock(operatorTz, c.timezone)}`);
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

CONSULT ENTITY — call another persona or council member's LLM in real-time to get their actual perspective:
:::CONSULT_ENTITY{"name":"<entity name>","question":"<specific question to ask them>"}:::
The named entity's AI will be invoked and their live response will replace this block inline.
Use this when you genuinely need another entity's unique expertise, personality, or knowledge — not for simple facts.
Example: :::CONSULT_ENTITY{"name":"Tao","question":"What's your read on this business model?"}:::

QUERY MAVIS — when you need factual lookups from MAVIS's memory or the operator's history (not a live entity response):
:::QUERY_MAVIS{"question":"<specific question>","target":"mavis|<persona name>|<council member name>"}:::
MAVIS will search memory and past conversations to answer. Use for factual recall, not opinions or live reasoning.

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

// ── A2A: detect if user wants MAVIS to consult another entity ────────────────
const A2A_PATTERNS = [
  /\b(?:ask|consult|check\s+with|run\s+(?:this|it)\s+by|get\s+input\s+from)\s+([A-Za-z][A-Za-z0-9_'-]{1,})\b/i,
  /\bwhat\s+(?:does|would|did|do)\s+([A-Za-z][A-Za-z0-9_'-]{1,})\s+(?:think|say|know|recommend|suggest|feel)/i,
  /\b([A-Za-z][A-Za-z0-9_'-]{1,})'s\s+(?:thoughts|take|opinion|input|perspective|view|insights?|read)\b/i,
  /\bget\s+([A-Za-z][A-Za-z0-9_'-]{1,})'s\s+(?:thoughts|take|opinion|input|perspective|view|insights?)/i,
  /\b(?:have|let|get)\s+([A-Za-z][A-Za-z0-9_'-]{1,})\s+(?:weigh\s+in|respond|reply|answer)\b/i,
];
const A2A_SKIP = new Set(["me","you","him","her","them","us","it","this","that","the","a","an","my","your","their","our","its","mavis"]);

async function resolveA2AForTelegram(text: string, uid: string): Promise<string> {
  let targetName: string | null = null;
  for (const pat of A2A_PATTERNS) {
    const m = text.match(pat);
    if (m?.[1] && !A2A_SKIP.has(m[1].toLowerCase()) && m[1].length >= 2) {
      targetName = m[1];
      break;
    }
  }
  if (!targetName) return "";

  // Resolve name to persona or council entity
  const [pRes, cRes] = await Promise.all([
    sb.from("personas").select("id, name, role, system_prompt, bio, archetype, model").eq("user_id", uid).ilike("name", targetName).maybeSingle(),
    sb.from("councils").select("id, name, role, specialty, personality_prompt, notes, model").eq("user_id", uid).ilike("name", targetName).maybeSingle(),
  ]);

  const persona  = pRes.data as any;
  const council  = cRes.data as any;
  if (!persona && !council) return "";

  const entityName = persona?.name ?? council?.name;

  // Build a minimal system prompt for the entity
  let entitySystem: string;
  if (persona) {
    const p: string[] = [`You are ${persona.name}${persona.role ? `, ${persona.role}` : ""}.`];
    if (persona.archetype?.trim()) p.push(`Archetype: ${persona.archetype.trim()}`);
    if (persona.bio?.trim())       p.push(`Background: ${persona.bio.trim()}`);
    if (persona.system_prompt?.trim()) p.push(persona.system_prompt.trim());
    p.push(`Stay in character as ${persona.name}. Be direct and concise — Telegram format, under 200 words.`);
    entitySystem = p.join("\n");
  } else {
    const c: string[] = [`You are ${council.name}${council.role ? `, ${council.role}` : ""}${council.specialty ? ` specialising in ${council.specialty}` : ""}.`];
    if (council.notes?.trim())              c.push(`Background: ${council.notes.trim()}`);
    if (council.personality_prompt?.trim()) c.push(council.personality_prompt.trim());
    c.push(`Speak from your expertise, directly and concisely. Under 200 words.`);
    entitySystem = c.join("\n");
  }

  // Pull last few turns of convo with this entity for context
  let entityHistory: ChatMessage[] = [];
  if (persona) {
    const { data: hist } = await sb.from("persona_conversations")
      .select("role, content").eq("persona_id", persona.id).eq("user_id", uid)
      .order("created_at", { ascending: false }).limit(8);
    entityHistory = ((hist ?? []) as any[]).reverse().map((m: any) => ({ role: m.role, content: String(m.content ?? "") }));
  } else {
    const { data: hist } = await sb.from("council_chat_messages")
      .select("role, content").eq("council_member_id", council.id).eq("user_id", uid)
      .order("created_at", { ascending: false }).limit(8);
    entityHistory = ((hist ?? []) as any[]).reverse().map((m: any) => ({ role: m.role, content: String(m.content ?? "") }));
  }

  const entityModel = persona?.model ?? council?.model ?? "gemini-2.0-flash";
  const entityMessages: ChatMessage[] = [
    ...entityHistory,
    { role: "user", content: text },
  ];

  const response = await Promise.race([
    callLLM(entityModel, entitySystem, entityMessages, 400),
    new Promise<string>(r => setTimeout(() => r(""), 8_000)),
  ]);

  if (!response?.trim()) return "";

  return `\n\n═══ LIVE A2A CONSULTATION — ${entityName.toUpperCase()} RESPONDED ═══\n${response.trim()}\n═══ END A2A — relay this perspective in your reply ═══`;
}

// Parse PROPOSE_ACTION and PROPOSE_MAVIS blocks from a raw LLM reply.
// Returns the stripped visible text + confirmation lines to append.
async function parseAndHandleProposals(
  rawReply: string,
  uid: string,
  chatId: string | number,
  charName: string,
): Promise<string> {
  const ACTION_RE   = /:::PROPOSE_ACTION(\{[\s\S]*?\}):::/g;
  const MAVIS_RE    = /:::PROPOSE_MAVIS(\{[\s\S]*?\}):::/g;
  const QUERY_RE    = /:::QUERY_MAVIS(\{[\s\S]*?\}):::/g;
  const CONSULT_RE  = /:::CONSULT_ENTITY(\{[\s\S]*?\}):::/g;

  const actionResults: string[] = [];
  const mavisProposals: Array<{ type: string; summary: string; details: string; payload: Record<string, any> }> = [];

  let match: RegExpExecArray | null;
  let workingReply = rawReply;

  // ── Resolve CONSULT_ENTITY blocks: call the entity's LLM live ──────────────
  const consultBlocks: Array<{ full: string; answer: string }> = [];
  CONSULT_RE.lastIndex = 0;
  while ((match = CONSULT_RE.exec(workingReply)) !== null) {
    try {
      const { name, question } = JSON.parse(match[1]);
      if (name && question) {
        const live = await Promise.race([
          resolveA2AForTelegram(String(question), uid),
          new Promise<string>(r => setTimeout(() => r(""), 8_000)),
        ]);
        // Extract just the entity response text from the A2A block
        const inner = live.replace(/═══[^═]*═══/g, "").trim();
        consultBlocks.push({ full: match[0], answer: inner || `[${name} was unavailable]` });
      }
    } catch { /* malformed — skip */ }
  }
  for (const { full, answer } of consultBlocks) {
    workingReply = workingReply.replace(full, answer);
  }

  // ── Resolve QUERY_MAVIS blocks inline (memory lookup — not live LLM) ────────
  const queryBlocks: Array<{ full: string; answer: string }> = [];
  QUERY_RE.lastIndex = 0;
  while ((match = QUERY_RE.exec(workingReply)) !== null) {
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
            | "list_council" | "list_agency" | "switch_agency" | "chat";
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

  // Agency commands
  if (/^\/?(agencies?|agency\s+list|the\s+agency)$/i.test(lower))
    return { intent: "list_agency", params: {} };
  const agencyMatch = text.match(/^\/?(agency)\s+(.+)$/i);
  if (agencyMatch)
    return { intent: "switch_agency", params: { query: agencyMatch[2].trim() } };

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
    `*Personas, Council & Agency:*\n` +
    `🎭 \`/personas\` — list your personas\n` +
    `🏛️ \`/council\` — list your council members\n` +
    `🏢 \`/agency\` — browse 182 Agency specialists\n` +
    `🏢 \`/agency [task]\` — auto-route to best specialist\n` +
    `🎭 \`/as [name]\` or \`/[name]\` — switch to a persona or council member\n` +
    `✨ \`/mavis\` — return to MAVIS (deactivates all)\n\n` +
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
    .select("id, name, role, archetype, personality, system_prompt, model, timezone, agent_folders")
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
    timezone:      p.timezone ? String(p.timezone) : undefined,
    agent_folders: p.agent_folders && typeof p.agent_folders === "object" ? p.agent_folders as Record<string, string> : undefined,
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
  await setActiveAgency(uid, null);
  await send(chatId, `✨ *MAVIS online.* Session ended.`);
}

// ─────────────────────────────────────────────────────────────
// AGENCY HANDLERS
// ─────────────────────────────────────────────────────────────

async function handleListAgency(chatId: string | number, uid: string) {
  const active = await getActiveAgency(uid);
  const divLines = Object.entries(AGENCY_MANIFEST).map(([div, agents]) => {
    const label = div.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    return `${label} (${agents.length})`;
  });
  const activeLine = active
    ? `\n\n✅ *Active specialist:* ${active.name} [${active.division}]\nSend \`/mavis\` to deactivate.`
    : "";
  await send(chatId,
    `🏢 *The Agency — 182 specialists*\n\n` +
    divLines.join(" · ") +
    `${activeLine}\n\n` +
    `*Activate by task:* \`/agency [describe your task]\`\n` +
    `_Example: /agency I need to optimize my SEO strategy_\n` +
    `_Example: /agency build a REST API with auth_\n` +
    `_Example: /agency close this sales deal_`,
  );
}

async function handleSwitchAgency(chatId: string | number, uid: string, query: string) {
  await send(chatId, `🔍 _Routing to best specialist for: "${query.slice(0, 80)}"…_`);

  const match = agencyFindBest(query);
  if (!match) {
    await send(chatId, `⚠️ Couldn't find a matching specialist. Try \`/agency\` to see divisions.`);
    return;
  }

  // Fetch the spec from GitHub
  let spec = "";
  try {
    const res = await fetch(match.rawUrl, { signal: AbortSignal.timeout(10000) });
    if (res.ok) spec = await res.text();
  } catch { /* use empty spec — still activates */ }

  if (!spec) {
    await send(chatId,
      `⚠️ Found specialist *${match.name}* but couldn't load their spec from GitHub.\n` +
      `Try again in a moment or activate from the Agency tab in the app.`,
    );
    return;
  }

  const session: AgencySession = {
    agent_id: match.agentId,
    name:     match.name,
    division: match.division,
    raw_url:  match.rawUrl,
    spec,
  };

  await setActiveAgency(uid, session);

  const divLabel = match.division.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  await send(chatId,
    `🏢 *Now operating as ${match.name}*\n` +
    `Division: ${divLabel}\n\n` +
    `Send your message and I'll respond as this specialist.\n` +
    `Send \`/mavis\` to return to MAVIS.`,
  );
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
    .select("id, name, role, specialty, personality_prompt, notes, timezone, agent_folders")
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
    timezone:         m.timezone ? String(m.timezone) : undefined,
    agent_folders:    m.agent_folders && typeof m.agent_folders === "object" ? m.agent_folders as Record<string, string> : undefined,
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

// ── Multi-entity directed dialogue detection ──────────────────────────────────
const MULTI_ENTITY_PATTERNS = [
  /\b(?:have|get|let|make)\s+([A-Za-z][A-Za-z0-9_'-]+)\s+and\s+([A-Za-z][A-Za-z0-9_'-]+)\s+(?:discuss|talk\s+about|debate|explore|share\s+thoughts\s+on|weigh\s+in\s+on)(.*)/i,
  /\b(?:start|run|set\s*up)\s+(?:a\s+)?(?:conversation|discussion|debate|dialogue)\s+between\s+([A-Za-z][A-Za-z0-9_'-]+)\s+and\s+([A-Za-z][A-Za-z0-9_'-]+)(.*)/i,
  /\b([A-Za-z][A-Za-z0-9_'-]+)\s+and\s+([A-Za-z][A-Za-z0-9_'-]+)\s+(?:should|need\s+to)\s+(?:discuss|talk\s+about|debate)(.*)/i,
];

async function resolveMultiEntityDialogue(text: string, uid: string): Promise<string> {
  let nameA: string | null = null;
  let nameB: string | null = null;
  let topic = text;

  for (const pat of MULTI_ENTITY_PATTERNS) {
    const m = text.match(pat);
    if (m?.[1] && m?.[2]) {
      nameA  = m[1];
      nameB  = m[2];
      topic  = (m[3] ?? "").trim() || text;
      break;
    }
  }
  if (!nameA || !nameB) return "";
  if (A2A_SKIP.has(nameA.toLowerCase()) || A2A_SKIP.has(nameB.toLowerCase())) return "";

  // Look up both entities in parallel
  const [pA, cA, pB, cB] = await Promise.all([
    sb.from("personas").select("id,name,role,system_prompt,bio,archetype,model").eq("user_id",uid).ilike("name",nameA).maybeSingle(),
    sb.from("councils").select("id,name,role,specialty,personality_prompt,notes,model").eq("user_id",uid).ilike("name",nameA).maybeSingle(),
    sb.from("personas").select("id,name,role,system_prompt,bio,archetype,model").eq("user_id",uid).ilike("name",nameB).maybeSingle(),
    sb.from("councils").select("id,name,role,specialty,personality_prompt,notes,model").eq("user_id",uid).ilike("name",nameB).maybeSingle(),
  ]);

  const entityA = (pA.data ?? cA.data) as any;
  const entityB = (pB.data ?? cB.data) as any;
  if (!entityA || !entityB) return "";

  const labelA = entityA.name as string;
  const labelB = entityB.name as string;

  function buildSystem(e: any, isPers: boolean): string {
    if (isPers) {
      const parts = [`You are ${e.name}${e.role ? `, ${e.role}` : ""}.`];
      if (e.archetype?.trim()) parts.push(`Archetype: ${e.archetype.trim()}`);
      if (e.bio?.trim())       parts.push(`Background: ${e.bio.trim()}`);
      if (e.system_prompt?.trim()) parts.push(e.system_prompt.trim());
      parts.push(`Stay in character. Respond in 3-5 sentences — direct, opinionated, authentic.`);
      return parts.join("\n");
    }
    const parts = [`You are ${e.name}${e.role ? `, ${e.role}` : ""}${e.specialty ? ` specialising in ${e.specialty}` : ""}.`];
    if (e.notes?.trim()) parts.push(`Background: ${e.notes.trim()}`);
    if (e.personality_prompt?.trim()) parts.push(e.personality_prompt.trim());
    parts.push(`Speak from your expertise. 3-5 sentences — direct, strategic, authentic.`);
    return parts.join("\n");
  }

  const sysA = buildSystem(entityA, !!pA.data);
  const sysB = buildSystem(entityB, !!pB.data);
  const modelA = entityA.model ?? "gemini-2.0-flash";
  const modelB = entityB.model ?? "gemini-2.0-flash";

  // Turn 1: A responds to the topic
  const turn1Prompt = `The operator wants to hear your thoughts on: ${topic || text}. Speak naturally and directly.`;
  const turn1 = await Promise.race([
    callLLM(modelA, sysA, [{ role: "user", content: turn1Prompt }], 350),
    new Promise<string>(r => setTimeout(() => r(""), 8_000)),
  ]);
  if (!turn1?.trim()) return "";

  // Turn 2: B responds to A
  const turn2Prompt = `The operator wants to discuss: ${topic || text}\n\n${labelA} just said: "${turn1.trim()}"\n\nWhat's your take? Respond to ${labelA}'s points directly.`;
  const turn2 = await Promise.race([
    callLLM(modelB, sysB, [{ role: "user", content: turn2Prompt }], 350),
    new Promise<string>(r => setTimeout(() => r(""), 8_000)),
  ]);

  const lines: string[] = [`═══ DIALOGUE: ${labelA.toUpperCase()} × ${labelB.toUpperCase()} ═══`];
  lines.push(`\n*${labelA}:* ${turn1.trim()}`);
  if (turn2?.trim()) lines.push(`\n*${labelB}:* ${turn2.trim()}`);
  lines.push(`\n═══ END DIALOGUE ═══`);

  return lines.join("\n");
}

async function handleChat(
  chatId: string | number,
  uid: string,
  text: string,
  history: ChatMessage[],
  sessionId: string | null,
) {
  await typing(chatId);

  // ── Multi-entity / single A2A pre-pass ────────────────────────────────────
  let a2aBlock = "";
  if (text.length > 5) {
    try {
      // Multi-entity dialogue takes priority over single A2A
      const multiBlock = await Promise.race([
        resolveMultiEntityDialogue(text, uid),
        new Promise<string>(r => setTimeout(() => r(""), 18_000)),
      ]);
      if (multiBlock) {
        // For directed dialogues: send the exchange directly and return
        await send(chatId, multiBlock);
        if (sessionId) await saveExchange(sessionId, uid, text, multiBlock);
        return;
      }
      a2aBlock = await Promise.race([
        resolveA2AForTelegram(text, uid),
        new Promise<string>(r => setTimeout(() => r(""), 12_000)),
      ]);
    } catch { /* non-critical */ }
  }

  // ── URL content extraction ─────────────────────────────────────────────────
  // YouTube        → mavis-youtube-ingest (captions + Claude summary)
  // TikTok/IG/Twitter → mavis-shortform-ingest (Whisper transcription + Claude summary)
  // All other URLs → Jina Reader markdown extraction
  let urlContent = "";
  {
    const URL_RE = /https?:\/\/[^\s<>"',;)]+/g;
    const foundUrls = text.match(URL_RE);
    if (foundUrls?.length) {
      const target = foundUrls[0].replace(/[.,;!?)]+$/, "");
      const isYouTube    = /(?:youtube\.com\/watch|youtu\.be\/)/.test(target);
      const isShortForm  = /tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com|instagram\.com\/(reel|p)\/|twitter\.com|x\.com\/\w+\/status\//i.test(target);
      try {
        if (isYouTube) {
          // Run caption extraction + Gemini visual analysis in parallel
          const [ytRes, geminiRes] = await Promise.allSettled([
            fetch(`${SUPABASE_URL}/functions/v1/mavis-youtube-ingest`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
              body: JSON.stringify({ url: target, save_as: "note", _preview: true }),
              signal: AbortSignal.timeout(25000),
            }),
            fetch(`${SUPABASE_URL}/functions/v1/mavis-vision-agent`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
              body: JSON.stringify({ action: "analyze_youtube", url: target }),
              signal: AbortSignal.timeout(90000),
            }),
          ]);

          const parts: string[] = [`\n═══ YOUTUBE VIDEO ═══\nURL: ${target}`];

          if (ytRes.status === "fulfilled" && ytRes.value.ok) {
            const ytData = await ytRes.value.json();
            const title   = ytData.title   ?? "YouTube Video";
            const summary = ytData.summary  ?? "";
            const excerpt = ytData.transcript ? String(ytData.transcript).slice(0, 6000) : "";
            parts.push(`TITLE: ${title}`);
            if (summary) parts.push(`CAPTION SUMMARY:\n${summary}`);
            if (excerpt) parts.push(`TRANSCRIPT EXCERPT:\n${excerpt}`);
          }

          if (geminiRes.status === "fulfilled" && geminiRes.value.ok) {
            const gData = await geminiRes.value.json();
            if (gData.analysis) parts.push(`GEMINI VISUAL ANALYSIS (watched the video):\n${gData.analysis}`);
          }

          if (parts.length > 1) {
            urlContent = parts.join("\n\n") + `\n═══ END YOUTUBE CONTENT ═══`;
          } else {
            const jinaRes = await fetch(`https://r.jina.ai/${target}`, {
              headers: { Accept: "text/plain", "X-No-Cache": "true", "X-Timeout": "15" },
              signal: AbortSignal.timeout(18000),
            });
            if (jinaRes.ok) {
              const jinaText = await jinaRes.text();
              if (jinaText.length > 100) urlContent = `\n═══ URL CONTENT: ${target} ═══\n${jinaText.slice(0, 14000)}\n═══ END URL CONTENT ═══`;
            }
          }
        } else if (isShortForm) {
          // Short-form video: download + Whisper transcription
          const sfRes = await fetch(`${SUPABASE_URL}/functions/v1/mavis-shortform-ingest`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({ url: target, save_as: "note", _preview: true }),
            signal: AbortSignal.timeout(55000),
          });
          if (sfRes.ok) {
            const sfData = await sfRes.json();
            const title    = sfData.title    ?? "Video";
            const platform = sfData.platform ?? "short-form";
            const summary  = sfData.summary  ?? "";
            const excerpt  = sfData.transcript ? String(sfData.transcript).slice(0, 8000) : "";
            const label    = platform === "tiktok" ? "TIKTOK" : platform === "instagram" ? "INSTAGRAM REEL" : "TWITTER/X VIDEO";
            urlContent = `\n═══ ${label}: ${title} ═══\nURL: ${target}\n\nSUMMARY:\n${summary}\n\nTRANSCRIPT:\n${excerpt}\n═══ END VIDEO CONTENT ═══`;
          } else {
            // Fallback to Jina for metadata if transcription fails
            const jinaRes = await fetch(`https://r.jina.ai/${target}`, {
              headers: { Accept: "text/plain", "X-No-Cache": "true", "X-Timeout": "15" },
              signal: AbortSignal.timeout(18000),
            });
            if (jinaRes.ok) {
              const jinaText = await jinaRes.text();
              if (jinaText.length > 100) urlContent = `\n═══ URL CONTENT: ${target} ═══\n${jinaText.slice(0, 14000)}\n═══ END URL CONTENT ═══`;
            }
          }
        } else {
          const jinaKey = Deno.env.get("JINA_API_KEY") ?? "";
          const jinaHeaders: Record<string, string> = {
            Accept: "text/plain",
            "X-No-Cache": "true",
            "X-Timeout": "15",
          };
          if (jinaKey) jinaHeaders["Authorization"] = `Bearer ${jinaKey}`;
          const jinaRes = await fetch(`https://r.jina.ai/${target}`, {
            headers: jinaHeaders,
            signal: AbortSignal.timeout(18000),
          });
          if (jinaRes.ok) {
            const jinaText = await jinaRes.text();
            if (jinaText.length > 100) urlContent = `\n═══ URL CONTENT: ${target} ═══\n${jinaText.slice(0, 14000)}\n═══ END URL CONTENT ═══`;
          }
        }
      } catch { /* non-critical — continue without URL content */ }
    }
  }

  // ── Council member mode ────────────────────────────────────────────────────
  const activeCouncil = await getActiveCouncil(uid);
  if (activeCouncil) {
    try {
      // Load app context, conversation history, and operator timezone in parallel
      const [appCtx, councilHistRes, profileRes] = await Promise.all([
        loadAppContext(uid),
        sb.from("council_chat_messages")
          .select("role, content")
          .eq("council_member_id", activeCouncil.id)
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(16),
        sb.from("profiles").select("timezone").eq("id", uid).maybeSingle(),
      ]);
      const operatorTz: string = (profileRes.data as any)?.timezone || "UTC";

      const councilSystem = buildCouncilSystemPrompt(activeCouncil, appCtx, operatorTz);
      const recentHistory: ChatMessage[] = ((councilHistRes.data ?? []).reverse() as any[]).map((m: any) => ({
        role:    m.role as "user" | "assistant",
        content: String(m.content ?? ""),
      }));
      const userContent = `${text}${a2aBlock}${urlContent}`;
      const msgs: ChatMessage[] = [...recentHistory, { role: "user", content: userContent }];
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

  // ── Agency specialist mode ────────────────────────────────────────────────
  const activeAgency = await getActiveAgency(uid);
  if (activeAgency) {
    try {
      const [appCtx, histRes, profileRes] = await Promise.all([
        loadAppContext(uid),
        sb.from("mavis_agency_conversations")
          .select("role, content")
          .eq("user_id", uid)
          .eq("agent_id", activeAgency.agent_id)
          .order("created_at", { ascending: false })
          .limit(16),
        sb.from("profiles").select("timezone").eq("id", uid).maybeSingle(),
      ]);
      const operatorTz: string = (profileRes.data as any)?.timezone || "UTC";
      const agencySystem = buildAgencySystemPrompt(activeAgency, appCtx, operatorTz);
      const recentHistory: ChatMessage[] = ((histRes.data ?? []).reverse() as any[]).map((m: any) => ({
        role:    m.role as "user" | "assistant",
        content: String(m.content ?? ""),
      }));
      const userContent = `${text}${a2aBlock}${urlContent}`;
      const msgs: ChatMessage[] = [...recentHistory, { role: "user", content: userContent }];
      const rawReply = await callLLM("claude-haiku-4-5-20251001", agencySystem, msgs, 1500);
      if (rawReply) {
        const reply = await parseAndHandleProposals(rawReply, uid, chatId, activeAgency.name);
        await send(chatId, reply);
        await sb.from("mavis_agency_conversations").insert([
          { user_id: uid, agent_id: activeAgency.agent_id, role: "user",      content: text     },
          { user_id: uid, agent_id: activeAgency.agent_id, role: "assistant", content: rawReply },
        ]).catch((err) => console.warn("[telegram-bot] agency_conversations write failed", err));
      } else {
        await send(chatId, `⚠️ ${activeAgency.name} is unavailable right now. Try again.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await send(chatId, `⚠️ Agency specialist error: ${msg.slice(0, 200)}`);
    }
    return;
  }

  // ── Persona mode: bypass mavis-agent, talk directly as the character ──────
  const activePersona = await getActivePersona(uid);
  if (activePersona) {
    try {
      // Load app context, conversation history, and operator timezone in parallel
      const [appCtx, personaHistRes, personaProfileRes] = await Promise.all([
        loadAppContext(uid),
        sb.from("persona_conversations")
          .select("role, content")
          .eq("persona_id", activePersona.id)
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(16),
        sb.from("profiles").select("timezone").eq("id", uid).maybeSingle(),
      ]);
      const operatorTz: string = (personaProfileRes.data as any)?.timezone || "UTC";

      const personaSystem = buildPersonaSystemPrompt(activePersona, appCtx, operatorTz);
      const recentHistory: ChatMessage[] = ((personaHistRes.data ?? []).reverse() as any[]).map((m: any) => ({
        role:    m.role as "user" | "assistant",
        content: String(m.content ?? ""),
      }));

      const userContent = `${text}${a2aBlock}${urlContent}`;
      const msgs: ChatMessage[] = [...recentHistory, { role: "user", content: userContent }];
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
    const finalUserText = `${text}${a2aBlock}${urlContent}`;
    const messages = [...recentHistory, { role: "user", content: finalUserText }];

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

    // NOTE: mavis-agent's queue_action tool already sends Telegram approval
    // buttons via sendTelegramNotification. Do NOT call sendPendingActionButtons
    // here — it would send a second set of buttons for the same action.

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

    // Video / animation / video_note — Gemini full visual analysis
    const videoObj = (message.video ?? message.animation ?? message.video_note) as Record<string, unknown> | undefined;
    if (!wasVoice && !wasPhoto && videoObj?.file_id) {
      const videoFileId  = String(videoObj.file_id ?? "");
      const videoMime    = String((videoObj as any).mime_type ?? "video/mp4");
      const videoCaption = message.caption ? String(message.caption) : undefined;
      const videoName    = String((videoObj as any).file_name ?? "video.mp4");

      await send(chatId, "🎬 Analyzing video... this may take 15-30 seconds.");
      await typing(chatId);

      try {
        const analysis = await analyzeVideoWithGemini(videoFileId, videoMime, videoName, videoCaption);
        // Inject Gemini's analysis as the user's message so it flows through the
        // normal MAVIS / persona / council routing (same pattern as photo captions).
        const sessionId = await getOrCreateSession(uid);
        const history   = sessionId ? await loadHistory(sessionId) : [];
        const userPrompt = `[Video uploaded — Gemini visual analysis below]\n\n${analysis}`;
        await handleChat(chatId, uid, userPrompt, history, sessionId);
      } catch (err: any) {
        console.error("[telegram-video]", err.message);
        await send(chatId, `❌ Video analysis failed: ${err.message.slice(0, 200)}`);
      }
      return;
    }

    // Document / audio file — text extraction or image routing
    const doc = (message.document ?? (!wasVoice && message.audio)) as Record<string, unknown> | undefined;
    if (!wasVoice && !wasPhoto && doc?.file_id) {
      await typing(chatId);
      const fileName = String(doc.file_name ?? "file");

      // Documents that are videos → route to Gemini visual analysis
      const docMime = String((doc as any).mime_type ?? "");
      if (docMime.startsWith("video/")) {
        const videoCaption = message.caption ? String(message.caption) : undefined;
        await send(chatId, "🎬 Analyzing video... this may take 15-30 seconds.");
        try {
          const analysis = await analyzeVideoWithGemini(String(doc.file_id), docMime, fileName, videoCaption);
          const sessionId = await getOrCreateSession(uid);
          const history   = sessionId ? await loadHistory(sessionId) : [];
          const userPrompt = `[Video uploaded — Gemini visual analysis below]\n\n${analysis}`;
          await handleChat(chatId, uid, userPrompt, history, sessionId);
        } catch (err: any) {
          console.error("[telegram-video-doc]", err.message);
          await send(chatId, `❌ Video analysis failed: ${err.message.slice(0, 200)}`);
        }
        return;
      }

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
        case "list_agency":     await handleListAgency(chatId, uid); break;
        case "switch_persona":  await handleSwitchPersona(chatId, uid, params.name ?? ""); break;
        case "switch_agency":   await handleSwitchAgency(chatId, uid, params.query ?? ""); break;
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
