// mavis-comic-agent
// Daily comic strip fetcher + Claude vision dialogue extractor + bilingual translator + poster.
// Currently supports any GoComics strip (default: Calvin and Hobbes).
// Mirrors n8n: Schedule → param (date) → HTTP Request (scrape) → Information Extractor (image URL)
//              → OpenAI vision (translate dialogue) → Discord post.
//
// Requires: ANTHROPIC_API_KEY for vision + translation
//           DISCORD_COMIC_WEBHOOK (optional env) for Discord posting
//           TELEGRAM_BOT_TOKEN + TELEGRAM_OPERATOR_CHAT_ID for Telegram posting
//
// Actions: get_comic | translate_comic | daily_comic_post

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_SRK        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const BOT_TOKEN     = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const OPERATOR_CHAT = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";
const DISCORD_HOOK  = Deno.env.get("DISCORD_COMIC_WEBHOOK") ?? "";

// ── Comic scraping ────────────────────────────────────────────────────────────

async function fetchComicImageUrl(strip: string, year: string, month: string, day: string): Promise<string> {
  const url = `https://www.gocomics.com/${strip}/${year}/${month}/${day}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`GoComics returned ${res.status} for ${url}`);
  const html = await res.text();

  // AMUniversal CDN images are 32-char lowercase hex; appear in src, srcset, data-srcset
  const matches = html.match(/https:\/\/assets\.amuniversal\.com\/[a-f0-9]{32}/g);
  if (!matches || matches.length === 0) {
    throw new Error(`Comic image not found in GoComics page. The page structure may have changed: ${url}`);
  }
  return matches[0];  // first match is always the full-res strip
}

// ── Claude vision ─────────────────────────────────────────────────────────────

async function analyzeComic(imageUrl: string, targetLanguage: string, model: string): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "url", url: imageUrl } },
          {
            type: "text",
            text:
              `Read every piece of dialogue and text in this comic strip.\n` +
              `For each line, write it in this exact format:\n` +
              `Character: "ORIGINAL TEXT" (${targetLanguage} translation)\n\n` +
              `Rules:\n` +
              `- Identify each speaker (Calvin, Hobbes, Narrator box, sign text, etc.)\n` +
              `- Preserve the original text exactly as shown in the comic\n` +
              `- Translate accurately into ${targetLanguage}\n` +
              `- If a panel has no dialogue, describe the visual gag on one line in both English and ${targetLanguage}\n` +
              `- Return ONLY the formatted lines. No preamble, no explanation.`,
          },
        ],
      }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Claude vision error: ${JSON.stringify(data?.error).slice(0, 200)}`);
  return (data.content?.[0]?.text ?? "").trim();
}

// ── Main ──────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body       = await req.json().catch(() => ({}));
    const adminSb    = createClient(SB_URL, SB_SRK);
    const authHeader = req.headers.get("Authorization") ?? "";

    let uid: string;
    if (authHeader === `Bearer ${SB_SRK}`) {
      uid = String(body.userId ?? body.user_id ?? "").trim();
      if (!uid) return json({ error: "userId required for service-role calls" }, 400);
    } else if (authHeader.startsWith("Bearer ")) {
      const { data: { user }, error } = await adminSb.auth.getUser(authHeader.replace("Bearer ", ""));
      if (error || !user) return json({ error: "Unauthorized" }, 401);
      uid = user.id;
    } else {
      return json({ error: "Unauthorized" }, 401);
    }

    const action = String(body.action ?? "daily_comic_post");

    // Date — default to today
    const now   = new Date();
    const year  = String(body.year  ?? now.getFullYear());
    const month = String(body.month ?? String(now.getMonth() + 1)).padStart(2, "0");
    const day   = String(body.day   ?? String(now.getDate())).padStart(2, "0");
    const strip = String(body.strip ?? "calvinandhobbes");
    const lang  = String(body.target_language ?? body.language ?? "Korean");
    const model = String(body.model ?? "claude-haiku-4-5-20251001");
    const dateLabel = `${year}/${month}/${day}`;
    const stripLabel = strip === "calvinandhobbes" ? "Calvin & Hobbes" : strip;

    switch (action) {

      case "get_comic": {
        const imageUrl = await fetchComicImageUrl(strip, year, month, day);
        return json({
          strip,
          date:       dateLabel,
          image_url:  imageUrl,
          comic_page: `https://www.gocomics.com/${strip}/${dateLabel}`,
        });
      }

      case "translate_comic": {
        const imageUrl = await fetchComicImageUrl(strip, year, month, day);
        const dialogue = await analyzeComic(imageUrl, lang, model);
        return json({ strip, date: dateLabel, image_url: imageUrl, dialogue, target_language: lang });
      }

      case "daily_comic_post": {
        // Full pipeline: scrape → vision translate → Discord + Telegram
        const discordWebhook = String(body.discord_webhook ?? DISCORD_HOOK);
        const chatId         = String(body.telegram_chat_id ?? OPERATOR_CHAT);
        const postTelegram   = body.telegram !== false && BOT_TOKEN && chatId;

        // 1. Get comic image
        const imageUrl = await fetchComicImageUrl(strip, year, month, day);

        // 2. Translate dialogue via Claude vision
        const dialogue = await analyzeComic(imageUrl, lang, model);

        const results: Record<string, any> = {
          strip,
          date:       dateLabel,
          image_url:  imageUrl,
          dialogue,
          target_language: lang,
        };

        // 3. Post to Discord webhook
        if (discordWebhook) {
          const discordContent = [
            `🗞️ **Daily Comic — ${stripLabel}** (${dateLabel})`,
            imageUrl,
            ``,
            dialogue,
          ].join("\n").slice(0, 2000);

          const dRes = await fetch(discordWebhook, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ content: discordContent }),
            signal:  AbortSignal.timeout(10000),
          });
          results.discord_posted = dRes.ok;
          results.discord_status = dRes.status;
        }

        // 4. Post to Telegram — send image + caption
        if (postTelegram) {
          const caption = `📰 ${stripLabel} · ${dateLabel}\n\n${dialogue}`.slice(0, 1024);

          const tPhotoRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ chat_id: chatId, photo: imageUrl, caption }),
            signal:  AbortSignal.timeout(15000),
          }).catch(() => null);

          if (tPhotoRes?.ok) {
            results.telegram_posted = true;
          } else {
            // Fallback: text message with image URL
            const tTextRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body:    JSON.stringify({ chat_id: chatId, text: `${imageUrl}\n\n${caption}`.slice(0, 4096), parse_mode: "Markdown" }),
              signal:  AbortSignal.timeout(10000),
            }).catch(() => null);
            results.telegram_posted   = false;
            results.telegram_fallback = tTextRes?.ok ?? false;
          }
        }

        // Log to memory
        await adminSb.from("mavis_memory").insert({
          user_id:    uid,
          role:       "assistant",
          content:    `[COMIC] Posted ${stripLabel} for ${dateLabel}: ${dialogue.slice(0, 200)}`,
          tags:       ["comic", "daily_comic", strip, "scheduled_content"],
          importance: 3,
        }).catch(() => {});

        return json(results);
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: get_comic | translate_comic | daily_comic_post`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-comic-agent]", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
