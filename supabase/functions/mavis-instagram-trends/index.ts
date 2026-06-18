// MAVIS Instagram Trends — AI-powered Instagram content from trending hashtags.
// Mirrors n8n "Generate Instagram Content from Top Trends with AI Image Generation":
//   1. Scrape top posts for hashtags via RapidAPI Instagram Scraper
//   2. Deduplicate against mavis_instagram_trends (skip already-processed content_codes)
//   3. Claude vision: describe the trending image
//   4. Claude Haiku: craft Instagram caption with hashtags
//   5. fal.ai Flux Schnell: generate a new isometric toy-aesthetic image
//   6. Instagram Graph API 2-step publish (via mavis-instagram-agent publish_image)
//   7. Telegram status notifications
//
// Actions: discover_trends | run_pipeline
// Schedule: 2× daily (n8n ran at 13:05 and 19:05 Istanbul time)
//
// Requires: RAPIDAPI_KEY + ANTHROPIC_API_KEY + FAL_API_KEY + TELEGRAM_BOT_TOKEN
//           mavis_user_integrations provider='instagram' for publishing

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_SRK        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const FAL_KEY       = Deno.env.get("FAL_API_KEY")!;
const RAPIDAPI_KEY  = Deno.env.get("RAPIDAPI_KEY")!;
const BOT_TOKEN     = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

const RAPID_HOST = "instagram-scraper-api2.p.rapidapi.com";
const IG_SCRAPER = `https://${RAPID_HOST}/v1/hashtag`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Trend scraping ────────────────────────────────────────────────────────────

interface TrendItem {
  id: string;
  content_code: string;
  prompt: string;          // original caption text
  thumbnail_url: string;
  hashtag: string;
}

async function scrapeHashtag(hashtag: string, apiKey: string): Promise<TrendItem[]> {
  const res = await fetch(`${IG_SCRAPER}?hashtag=${encodeURIComponent(hashtag)}&feed_type=top`, {
    headers: {
      "x-rapidapi-host": RAPID_HOST,
      "x-rapidapi-key":  apiKey,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`RapidAPI scrape failed for #${hashtag}: ${res.status}`);
  const data = await res.json();
  const items = (data?.data?.items ?? []) as Record<string, unknown>[];
  return items
    .filter((item) => !item.is_video && item.thumbnail_url)
    .map((item) => ({
      id:            String(item.id ?? ""),
      content_code:  String(item.code ?? ""),
      prompt:        String((item.caption as Record<string, unknown>)?.text ?? ""),
      thumbnail_url: String(item.thumbnail_url ?? ""),
      hashtag:       String(data?.data?.additional_data?.name ?? hashtag),
    }));
}

// ── Claude helpers ────────────────────────────────────────────────────────────

async function claudeVision(imageUrl: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model:      "claude-sonnet-4-6",
      max_tokens: 512,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "url", url: imageUrl } },
          {
            type: "text",
            text: "Create a clear and concise description of the object in the image, focusing on its physical and general features. Avoid detailed environmental aspects like background, lighting, or colors. Describe the shape, texture, size, and any unique characteristics of the object. Mention any notable features that make the object stand out, such as its surface details, materials, and design. The description should be focused on the object itself, not its surroundings.",
          },
        ],
      }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Claude vision error: ${res.status}`);
  const data = await res.json();
  return String(data.content?.[0]?.text ?? "").trim();
}

async function claudeCaption(description: string, hashtag: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 256,
      messages: [{
        role: "user",
        content: `Summarize the following content description into a short, engaging Instagram caption under 150 words. The caption should focus on the content of the image, not the app. Keep it appealing to social media users, and highlight the visual details of the image. Include hashtags relevant to 3D modeling and design, such as #Blender3D, #3DArt, #DigitalArt, #3DModeling, and #ArtCommunity. Ensure the tone is friendly and inviting.\n\nContent description to summarize:\n${description}\n\nHashtag context: #${hashtag}`,
      }],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Claude caption error: ${res.status}`);
  const data = await res.json();
  return String(data.content?.[0]?.text ?? "").trim();
}

// ── fal.ai image generation (Flux Schnell, isometric toy aesthetic) ───────────

async function generateIsometricImage(description: string): Promise<string> {
  // Exact prompt template ported from n8n workflow
  const cleanDesc = description.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  const prompt = `A highly detailed 3D isometric model of ${cleanDesc} rendered in a stylized miniature toy aesthetic. Materials: Matte plastic/painted metal/weathered stone texture with no self-shadowing. Lighting: Completely shadowless rendering - Ultra bright and perfectly even illumination from all angles - Pure ambient lighting without directional shadows - Flat, consistent lighting across all surfaces - No ambient occlusion. Style specifications: Clean, defined edges and surfaces - Slightly exaggerated proportions - Miniature/toy-like scale - Subtle wear and texturing - Rich color palette with muted tones - Isometric 3/4 view angle - Crisp details and micro-elements. Technical details: 4K resolution - PBR materials without shadows - No depth of field - High-quality anti-aliasing - Perfect uniform lighting. Environment: Pure white background with zero shadows or gradients. Post-processing: High key lighting, maximum brightness, shadow removal.`;

  const res = await fetch("https://fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Key ${FAL_KEY}` },
    body:   JSON.stringify({ prompt, image_size: "square_hd", num_images: 1, output_format: "jpg" }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`fal.ai error: ${res.status} — ${await res.text().catch(() => "")}`);
  const data = await res.json();
  const url = data?.images?.[0]?.url ?? data?.image?.url ?? "";
  if (!url) throw new Error(`fal.ai returned no image URL: ${JSON.stringify(data).slice(0, 200)}`);
  return url as string;
}

// ── Telegram notification ─────────────────────────────────────────────────────

async function tgNotify(chatId: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}

// ── Instagram publish via mavis-instagram-agent ───────────────────────────────

async function publishToInstagram(userId: string, imageUrl: string, caption: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${SB_URL}/functions/v1/mavis-instagram-agent`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SB_SRK}` },
    body:    JSON.stringify({ userId, action: "publish_image", image_url: imageUrl, caption }),
    signal:  AbortSignal.timeout(180_000), // 3 min: 2× polling cycles
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(data.error ?? `Instagram publish failed: ${res.status}`));
  return data;
}

// ── Main ──────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { userId, action, ...p } = body as Record<string, unknown>;

    if (!userId) throw new Error("userId required");
    if (!action)  throw new Error("action required");

    const adminSb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });
    let result: unknown;

    switch (action as string) {
      // ── DISCOVER TRENDS ──────────────────────────────────────────────────────
      // Scrape top posts for one or more hashtags, filter image-only, return items.
      case "discover_trends": {
        const hashtags = Array.isArray(p.hashtags) ? p.hashtags as string[]
                       : typeof p.hashtag === "string" ? [p.hashtag]
                       : ["blender3d", "isometric"]; // n8n defaults
        const apiKey = String(p.rapidapi_key ?? RAPIDAPI_KEY);

        const results = await Promise.all(hashtags.map((h) => scrapeHashtag(h, apiKey).catch((e) => {
          console.error(`Scrape #${h} failed:`, e.message);
          return [] as TrendItem[];
        })));
        const items = results.flat();
        result = { items, count: items.length, hashtags };
        break;
      }

      // ── RUN FULL PIPELINE ────────────────────────────────────────────────────
      // discover → deduplicate → vision → caption → image gen → IG publish.
      // Mirrors n8n full automation (runs one unprocessed item per call to stay
      // within edge function timeouts; use a scheduled task to call repeatedly).
      case "run_pipeline": {
        const hashtags = Array.isArray(p.hashtags) ? p.hashtags as string[]
                       : ["blender3d", "isometric"];
        const apiKey      = String(p.rapidapi_key ?? RAPIDAPI_KEY);
        const telegramChatId = p.telegram_chat_id ? String(p.telegram_chat_id) : null;
        const maxItems    = Number(p.max_items ?? 1); // process N new items per run (default 1)

        // 1. Scrape trends
        const rawResults = await Promise.all(hashtags.map((h) => scrapeHashtag(h, apiKey).catch(() => [] as TrendItem[])));
        const allItems = rawResults.flat();

        if (allItems.length === 0) {
          result = { processed: 0, message: "No trend items found from RapidAPI" };
          break;
        }

        // 2. Deduplicate: fetch already-processed codes from Supabase
        const codes = allItems.map((i) => i.content_code).filter(Boolean);
        const { data: existingRows } = await adminSb
          .from("mavis_instagram_trends")
          .select("content_code")
          .eq("user_id", userId)
          .in("content_code", codes);
        const existingCodes = new Set((existingRows ?? []).map((r: Record<string, unknown>) => String(r.content_code)));

        const newItems = allItems.filter((i) => !existingCodes.has(i.content_code));
        if (newItems.length === 0) {
          result = { processed: 0, message: "All trend items already processed — no new content to create" };
          break;
        }

        // 3. Process up to maxItems new items
        const toProcess = newItems.slice(0, maxItems);
        const processed: Record<string, unknown>[] = [];

        for (const item of toProcess) {
          let stepResult: Record<string, unknown> = { content_code: item.content_code, hashtag: item.hashtag };
          try {
            // Insert DB record immediately to claim this item (prevents double-processing)
            await adminSb.from("mavis_instagram_trends").insert({
              user_id:           userId,
              content_code:      item.content_code,
              hashtag:           item.hashtag,
              original_caption:  item.prompt.slice(0, 2000),
              thumbnail_url:     item.thumbnail_url,
              is_posted:         false,
              created_at:        new Date().toISOString(),
            }).then(() => {});

            // Claude vision: describe the trending image
            const description = await claudeVision(item.thumbnail_url);
            stepResult.description = description.slice(0, 300);

            // Claude Haiku: craft Instagram caption
            const caption = await claudeCaption(description, item.hashtag);
            stepResult.caption = caption.slice(0, 300);

            // fal.ai: generate isometric toy-aesthetic image
            const generatedImageUrl = await generateIsometricImage(description);
            stepResult.generated_image_url = generatedImageUrl;

            // Instagram Graph API: 2-step publish
            const pubResult = await publishToInstagram(userId, generatedImageUrl, caption);
            stepResult = { ...stepResult, ...pubResult, success: true };

            // Mark as posted in Supabase
            await adminSb.from("mavis_instagram_trends")
              .update({
                is_posted:          true,
                generated_caption:  caption,
                generated_image_url: generatedImageUrl,
                instagram_post_id:  String(pubResult.media_id ?? ""),
                posted_at:          new Date().toISOString(),
              })
              .eq("user_id", userId)
              .eq("content_code", item.content_code)
              .then(() => {});

            if (telegramChatId) await tgNotify(telegramChatId, "✅ Instagram content shared! #" + item.hashtag);

          } catch (itemErr) {
            const msg = itemErr instanceof Error ? itemErr.message : String(itemErr);
            stepResult.error = msg;
            stepResult.success = false;
            if (telegramChatId) await tgNotify(telegramChatId, `❌ Instagram post failed: ${msg.slice(0, 200)}`);
          }
          processed.push(stepResult);
        }

        // Log to mavis_memory
        await adminSb.from("mavis_memory").insert({
          user_id:         userId,
          content:         `Instagram trends pipeline: ${processed.filter((p) => p.success).length}/${processed.length} posts published`,
          importance_score: 3,
          tags:            ["instagram", "trends", "content_automation"],
          timestamp:       Date.now(),
          consolidated:    false,
        }).then(() => {});

        result = { processed: processed.length, results: processed, total_discovered: allItems.length, new_items: newItems.length };
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}. Supported: discover_trends, run_pipeline`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
