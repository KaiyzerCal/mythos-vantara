// MAVIS Telegram Sender — proactive outbound messaging
// Any edge function can POST here to push a message to the operator via Telegram.
// Used by Director, Approval Queue, Goal Engine, Morning Brief, etc.
//
// Required env vars:
//   TELEGRAM_BOT_TOKEN          — from @BotFather
//   TELEGRAM_OPERATOR_CHAT_ID   — operator's Telegram user/chat ID

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BOT_TOKEN        = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const OPERATOR_CHAT_ID = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";
const TELEGRAM_API     = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : "";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ─────────────────────────────────────────────────────────────
// SEND HELPERS
// ─────────────────────────────────────────────────────────────

async function sendChunked(chatId: string, text: string, parseMode = "MarkdownV2"): Promise<boolean> {
  if (!TELEGRAM_API) return false;
  const MAX = 4096;

  // Escape for MarkdownV2 if needed
  const escapeV2 = (t: string) =>
    t.replace(/[_*[\]()~`>#+=|{}.!-]/g, (c) => `\\${c}`);

  const safe = parseMode === "MarkdownV2" ? escapeV2(text) : text;

  const chunks: string[] = [];
  let remaining = safe;
  while (remaining.length > MAX) {
    const slice      = remaining.slice(0, MAX);
    const lastBreak  = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"), MAX * 0.6 | 0);
    const splitAt    = lastBreak > MAX * 0.5 ? lastBreak : MAX;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);

  let ok = true;
  for (const chunk of chunks) {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id:    chatId,
        text:       chunk,
        parse_mode: parseMode,
      }),
    });
    if (!res.ok) {
      // Fall back to plain text on parse error
      const errBody = await res.text();
      if (errBody.includes("parse") || errBody.includes("Bad Request")) {
        await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: chunk }),
        }).catch(() => {});
      }
      ok = false;
    }
  }
  return ok;
}

// ─────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // Auth: service-role key required (internal calls only)
    const auth  = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    const chatId     = String(body.chat_id ?? OPERATOR_CHAT_ID);
    const text       = String(body.text ?? "").trim();
    const parseMode  = String(body.parse_mode ?? "MarkdownV2");
    const silent     = Boolean(body.silent);   // no_notification
    const replyMarkup = body.reply_markup;

    if (!chatId) return json({ error: "chat_id required (or set TELEGRAM_OPERATOR_CHAT_ID)" }, 400);
    if (!text)   return json({ error: "text required" }, 400);
    if (!BOT_TOKEN) return json({ error: "TELEGRAM_BOT_TOKEN not configured" }, 503);

    // If reply_markup is provided, send as a single message (no chunking)
    if (replyMarkup) {
      const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id:              chatId,
          text:                 text.slice(0, 4096),
          parse_mode:           parseMode === "MarkdownV2" ? "MarkdownV2" : parseMode,
          disable_notification: silent,
          reply_markup:         replyMarkup,
        }),
      });
      const data = await res.json();
      return json({ ok: res.ok, telegram: data });
    }

    const ok = await sendChunked(chatId, text, parseMode === "none" ? "" : parseMode);
    return json({ ok });

  } catch (err) {
    console.error("[telegram-sender]", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
