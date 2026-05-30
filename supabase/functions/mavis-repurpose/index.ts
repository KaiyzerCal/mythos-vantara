// MAVIS Repurpose
// Content repurposing pipeline — takes long-form content and generates
// platform-specific variants (Twitter thread, LinkedIn, Instagram, YouTube, short video script).
// Optionally saves the first tweet to mavis_social_posts as 'queued'.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_KEY    = Deno.env.get("OPENAI_API") ?? "";

// ─────────────────────────────────────────────────────────────
// Platform prompt map
// ─────────────────────────────────────────────────────────────

const PLATFORM_PROMPTS: Record<string, string> = {
  twitter_thread:
    "Convert to an engaging Twitter thread. 8-12 tweets, each under 280 chars. Start with a hook. End with a CTA. Format: numbered list of tweet texts.",
  linkedin_post:
    "Rewrite as a professional LinkedIn post. 150-300 words. Include hook, 3 value points, personal insight, and CTA. Professional but authentic tone.",
  instagram_caption:
    "Create an Instagram caption. 100-150 words. Engaging opener, story, 3-5 relevant hashtags at end.",
  youtube_description:
    "Write a YouTube video description. Include: hook paragraph (2-3 sentences), bullet-point key topics covered, about section, subscribe CTA. 200-300 words total.",
  short_video_script:
    "Write a 60-second short-form video script (TikTok/Reels). Include: hook (0-5s), main content (5-50s), CTA (50-60s). Format with timestamps.",
};

// ─────────────────────────────────────────────────────────────
// AI call — try Claude Haiku first, fallback to GPT-4o-mini
// ─────────────────────────────────────────────────────────────

async function callAI(systemPrompt: string, userContent: string, brandVoice?: string): Promise<string> {
  const voiceNote = brandVoice ? `\n\nTone/brand voice: ${brandVoice}` : "";
  const fullPrompt = `${systemPrompt}${voiceNote}\n\nCONTENT:\n${userContent}`;

  // Try Claude Haiku first
  if (ANTHROPIC_KEY) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1500,
          messages: [{ role: "user", content: fullPrompt }],
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const d = await res.json() as any;
        const text = d?.content?.[0]?.text ?? "";
        if (text) return text;
      } else {
        console.warn("[mavis-repurpose] Claude error:", res.status);
      }
    } catch (e: any) {
      console.warn("[mavis-repurpose] Claude timeout/error:", e?.message);
    }
  }

  // Fallback: GPT-4o-mini
  if (OPENAI_KEY) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: fullPrompt }],
        max_tokens: 1500,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI error (${res.status}): ${errText.slice(0, 200)}`);
    }
    const d = await res.json() as any;
    return d?.choices?.[0]?.message?.content ?? "";
  }

  throw new Error("No AI key configured. Set ANTHROPIC_API_KEY or OPENAI_API.");
}

// ─────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: bearer token
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid Authorization header" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Get user from JWT
  const jwt = authHeader.slice(7);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
  if (authErr || !user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let body: {
    content: string;
    title?: string;
    platforms?: string[];
    brand_voice?: string;
    save_to_queue?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { content, title, platforms, brand_voice, save_to_queue } = body;

  if (!content?.trim()) {
    return new Response(
      JSON.stringify({ error: "content is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const requestedPlatforms = Array.isArray(platforms) && platforms.length > 0
    ? platforms
    : Object.keys(PLATFORM_PROMPTS);

  const unknown = requestedPlatforms.filter(p => !PLATFORM_PROMPTS[p]);
  if (unknown.length > 0) {
    return new Response(
      JSON.stringify({ error: `Unknown platform(s): ${unknown.join(", ")}. Valid: ${Object.keys(PLATFORM_PROMPTS).join(", ")}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const inputContent = title ? `Title: ${title}\n\n${content}` : content;

  // Generate all variants in parallel
  const variantEntries = await Promise.all(
    requestedPlatforms.map(async (platform) => {
      try {
        const result = await callAI(PLATFORM_PROMPTS[platform], inputContent, brand_voice);
        return [platform, result] as const;
      } catch (e: any) {
        console.error(`[mavis-repurpose] ${platform} failed:`, e?.message);
        return [platform, `Error: ${e?.message ?? "generation failed"}`] as const;
      }
    }),
  );

  const variants: Record<string, string> = Object.fromEntries(variantEntries);

  // Optionally save first tweet to mavis_social_posts
  if (save_to_queue && requestedPlatforms.includes("twitter_thread") && variants.twitter_thread) {
    const twitterContent = variants.twitter_thread;
    // Extract the first tweet from the numbered list
    const lines = twitterContent.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
    const firstTweet = lines.find((l: string) => /^1[.)]\s/.test(l))?.replace(/^1[.)]\s*/, "") ?? lines[0] ?? "";

    if (firstTweet) {
      const { error: dbErr } = await supabase
        .from("mavis_social_posts")
        .insert({
          user_id:    user.id,
          platform:   "twitter",
          content:    firstTweet.slice(0, 280),
          status:     "queued",
          created_at: new Date().toISOString(),
        });

      if (dbErr) {
        console.error("[mavis-repurpose] DB insert error:", dbErr.message);
      }
    }
  }

  return new Response(
    JSON.stringify({ variants }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
