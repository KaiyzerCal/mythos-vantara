// mavis-story-agent
// AI-powered children's storytelling: Claude writes a ~900 char story, OpenAI TTS narrates it,
// fal.ai renders an illustration from a Claude-generated character description, then all three are
// posted to a Telegram channel (text → audio → image).
// Mirrors n8n: Schedule (12h) → Config (chatId) → Create story (LLM) →
//   [Send text | TTS → Send audio | Character prompt → fal.ai image → Send photo]
//
// Actions: generate_story | daily_story_post
//
// Requires:
//   ANTHROPIC_API_KEY  — story + image prompt generation
//   OPENAI_API_KEY     — TTS audio via tts-1
//   FAL_API_KEY        — image generation via flux/schnell
//   TELEGRAM_BOT_TOKEN + TELEGRAM_OPERATOR_CHAT_ID (or per-request telegram_chat_id)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_SRK        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_KEY    = (Deno.env.get("OPENAI_API_KEY") ?? Deno.env.get("OPENAI_API")) ?? "";
const FAL_KEY       = Deno.env.get("FAL_API_KEY") ?? "";
const BOT_TOKEN     = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const OPERATOR_CHAT = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";

// ── Claude helper ─────────────────────────────────────────────────────────────

async function callClaude(system: string, user: string, model: string, maxTokens: number): Promise<string> {
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
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Claude error: ${JSON.stringify(data?.error).slice(0, 200)}`);
  return (data.content?.[0]?.text ?? "").trim();
}

// ── Story generation ──────────────────────────────────────────────────────────

const STORY_SYSTEM =
  `You are a creative children's story author. Write a captivating short tale for kids, ` +
  `whisking them away to magical lands brimming with wisdom. Explore diverse themes in a fun ` +
  `and simple way, weaving in valuable messages. Dive into cultural adventures with lively ` +
  `language that sparks curiosity. Let your story inspire young minds through enchanting ` +
  `narratives that linger long after the last word. ` +
  `Keep the story to approximately 900 characters. Return ONLY the story text — no title prefix, no label.`;

async function generateStory(topic: string, language: string, model: string): Promise<string> {
  const prompt = topic
    ? `Write a children's story about: ${topic}. Language: ${language}.`
    : `Write a new imaginative children's story. Language: ${language}.`;
  return callClaude(STORY_SYSTEM, prompt, model, 512);
}

// ── Image prompt generation ───────────────────────────────────────────────────

const IMAGE_PROMPT_SYSTEM =
  `You are a children's book illustrator assistant. Given a story, describe its main characters ` +
  `based on their appearance — humans, animals, what kind they are, how they look. ` +
  `The image must have NO TEXT. Keep it wholesome, child-friendly, and vivid. ` +
  `Return ONLY the image description prompt, concise (under 120 words).`;

async function generateImagePrompt(story: string, model: string): Promise<string> {
  return callClaude(IMAGE_PROMPT_SYSTEM, story, model, 200);
}

// ── OpenAI TTS ────────────────────────────────────────────────────────────────

async function generateAudio(text: string, voice: string): Promise<ArrayBuffer | null> {
  if (!OPENAI_KEY) return null;
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
    body:   JSON.stringify({ model: "tts-1", input: text, voice }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    console.error("[story-agent] TTS error:", res.status, await res.text().catch(() => ""));
    return null;
  }
  return res.arrayBuffer();
}

// ── fal.ai image generation ───────────────────────────────────────────────────

async function generateImage(prompt: string): Promise<string | null> {
  if (!FAL_KEY) return null;
  const safePrompt = `children's book illustration, no text, no letters, ${prompt}`;
  const res = await fetch("https://fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Key ${FAL_KEY}` },
    body:   JSON.stringify({ prompt: safePrompt, image_size: "square_hd", num_images: 1 }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    console.error("[story-agent] fal.ai error:", res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = await res.json();
  return (data.images?.[0]?.url ?? data.image?.url ?? null) as string | null;
}

// ── Telegram helpers ──────────────────────────────────────────────────────────

async function tgSendMessage(chatId: string, text: string): Promise<boolean> {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096) }),
    signal:  AbortSignal.timeout(10000),
  }).catch(() => null);
  return res?.ok ?? false;
}

async function tgSendAudio(chatId: string, audioBuffer: ArrayBuffer, caption: string): Promise<boolean> {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("audio", new Blob([audioBuffer], { type: "audio/mpeg" }), "story.mp3");
  form.append("caption", caption.slice(0, 1024));
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendAudio`, {
    method: "POST",
    body:   form,
    signal: AbortSignal.timeout(30000),
  }).catch(() => null);
  return res?.ok ?? false;
}

async function tgSendPhoto(chatId: string, photoUrl: string): Promise<boolean> {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ chat_id: chatId, photo: photoUrl }),
    signal:  AbortSignal.timeout(15000),
  }).catch(() => null);
  return res?.ok ?? false;
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

    const action   = String(body.action ?? "daily_story_post");
    const topic    = String(body.topic ?? "");
    const language = String(body.language ?? body.target_language ?? "English");
    const voice    = String(body.voice ?? "alloy");
    const model    = String(body.model ?? "claude-haiku-4-5-20251001");
    const chatId   = String(body.telegram_chat_id ?? body.chat_id ?? OPERATOR_CHAT);

    switch (action) {

      case "generate_story": {
        const story = await generateStory(topic, language, model);
        return json({ story, language, topic: topic || null });
      }

      case "daily_story_post": {
        if (!BOT_TOKEN || !chatId) {
          throw new Error("TELEGRAM_BOT_TOKEN and telegram_chat_id are required for daily_story_post");
        }

        // 1. Generate story
        const story = await generateStory(topic, language, model);

        const results: Record<string, unknown> = { story, language };

        // 2. Send story text immediately — don't wait for audio/image
        results.text_sent = await tgSendMessage(chatId, story);

        // 3. TTS + image prompt in parallel
        const [audioBuffer, imagePrompt] = await Promise.all([
          generateAudio(story, voice),
          generateImagePrompt(story, model),
        ]);

        results.image_prompt = imagePrompt;

        // 4. Send audio
        if (audioBuffer) {
          results.audio_sent = await tgSendAudio(chatId, audioBuffer, "End of the Story for today .....");
        } else {
          results.audio_sent  = false;
          results.audio_error = "OPENAI_API_KEY not configured or TTS failed";
        }

        // 5. Generate and send illustration
        const imageUrl = await generateImage(imagePrompt);
        results.image_url = imageUrl;

        if (imageUrl) {
          results.image_sent = await tgSendPhoto(chatId, imageUrl);
        } else {
          results.image_sent  = false;
          results.image_error = "FAL_API_KEY not configured or image generation failed";
        }

        // 6. Log to memory
        await adminSb.from("mavis_memory").insert({
          user_id:    uid,
          role:       "assistant",
          content:    `[STORY] Posted children's story to Telegram (${chatId}): ${story.slice(0, 200)}`,
          tags:       ["story", "children_story", "daily_story", "scheduled_content"],
          importance: 3,
        }).catch(() => {});

        return json(results);
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: generate_story | daily_story_post`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-story-agent]", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
