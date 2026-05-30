// MAVIS Nora TikTok — Posts content to TikTok as the Nora Vale persona.
// Supports video posts (PULL_FROM_URL) or photo/text carousel drafts via the
// TikTok Content Posting API v2.
// Auth: Bearer JWT (user) or service-role (cron).
//
// Required env vars:
//   TIKTOK_NORA_ACCESS_TOKEN  — Nora's TikTok OAuth2 access token
//   TIKTOK_NORA_OPEN_ID       — Nora's TikTok open_id
//   ANTHROPIC_API_KEY         — for AI-generated captions/scripts
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TIKTOK_ACCESS_TOKEN = Deno.env.get("TIKTOK_NORA_ACCESS_TOKEN") ?? "";
const TIKTOK_OPEN_ID = Deno.env.get("TIKTOK_NORA_OPEN_ID") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function resolveUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try {
    const { data } = await adminSb.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ── Nora Vale persona for TikTok ──────────────────────────────────────────────

const NORA_TT_SYSTEM = `You are Nora Vale. Write a TikTok caption/hook (max 2200 chars). Start with a strong hook line (first 3 words matter). Talk about founder life, AI automation, or revenue secrets. Use line breaks. Max 5 hashtags. Conversational, punchy.`;

async function generateTikTokCaption(): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: NORA_TT_SYSTEM,
      messages: [
        {
          role: "user",
          content: "Generate a TikTok post about a contrarian insight from Nora's world.",
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${err}`);
  }

  const data = await res.json();
  const text: string = data.content?.[0]?.text?.trim() ?? "";
  if (!text) throw new Error("Empty response from Claude");
  return text.slice(0, 2200);
}

// ── TikTok Content Posting API helpers ───────────────────────────────────────

async function initVideoPost(
  caption: string,
  videoUrl: string,
): Promise<{ publish_id: string }> {
  const res = await fetch(
    "https://open.tiktokapis.com/v2/post/publish/video/init/",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TIKTOK_ACCESS_TOKEN}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: {
          title: caption.slice(0, 150),
          privacy_level: "PUBLIC_TO_EVERYONE",
          disable_comment: false,
        },
        source_info: {
          source: "PULL_FROM_URL",
          video_url: videoUrl,
        },
      }),
    },
  );

  const data = await res.json();

  if (!res.ok || data.error?.code !== "ok") {
    const errMsg = data.error?.message ?? JSON.stringify(data);
    throw new Error(`TikTok video init error (${res.status}): ${errMsg}`);
  }

  const publishId: string = data.data?.publish_id ?? "";
  if (!publishId) throw new Error("TikTok API did not return a publish_id");
  return { publish_id: publishId };
}

async function initPhotoPost(caption: string): Promise<{ publish_id: string } | null> {
  const res = await fetch(
    "https://open.tiktokapis.com/v2/post/publish/content/init/",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TIKTOK_ACCESS_TOKEN}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: {
          title: caption.slice(0, 150),
          privacy_level: "PUBLIC_TO_EVERYONE",
        },
        source_info: {
          source: "PULL_FROM_URL",
          photo_images: [],
          photo_cover_index: 0,
        },
        media_type: "PHOTO",
      }),
    },
  );

  // TikTok returns 400 for text-only posts (no photos provided) — treat as
  // expected fallback so caller can save a draft instead of hard-failing.
  if (res.status === 400) {
    console.warn(
      "[mavis-nora-tiktok] TikTok text-only posts require photos — caption generated and saved",
    );
    return null;
  }

  const data = await res.json();

  if (!res.ok || data.error?.code !== "ok") {
    const errMsg = data.error?.message ?? JSON.stringify(data);
    throw new Error(`TikTok photo init error (${res.status}): ${errMsg}`);
  }

  const publishId: string = data.data?.publish_id ?? "";
  if (!publishId) throw new Error("TikTok API did not return a publish_id");
  return { publish_id: publishId };
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  if (!TIKTOK_ACCESS_TOKEN || !TIKTOK_OPEN_ID) {
    return json(
      {
        success: false,
        error:
          "TIKTOK_NORA_ACCESS_TOKEN and TIKTOK_NORA_OPEN_ID must be configured",
      },
      400,
    );
  }

  let body: {
    user_id?: string;
    content?: string;
    generate?: boolean;
    video_url?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // Resolve user_id: prefer body (service-role cron), fall back to JWT
  let userId = body.user_id ?? null;
  if (!userId) {
    userId = await resolveUserId(req);
  }
  if (!userId) {
    return json(
      { error: "Unauthorized — provide user_id or a valid Bearer JWT" },
      401,
    );
  }

  const shouldGenerate = body.generate === true || !body.content?.trim();
  let caption = body.content?.trim() ?? "";
  const videoUrl = body.video_url?.trim() || undefined;

  try {
    if (shouldGenerate) {
      if (!ANTHROPIC_KEY) {
        return json(
          {
            success: false,
            error: "ANTHROPIC_API_KEY is not configured for generation",
          },
          400,
        );
      }
      caption = await generateTikTokCaption();
    }

    if (!caption) {
      return json(
        {
          success: false,
          error: "No content provided and generation was not requested",
        },
        400,
      );
    }

    let publishId: string | null = null;
    let status: "posted" | "draft" = "posted";

    if (videoUrl) {
      // Video post via PULL_FROM_URL
      try {
        const result = await initVideoPost(caption, videoUrl);
        publishId = result.publish_id;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("[mavis-nora-tiktok] Video post failed:", errMsg);
        return json({ success: false, error: errMsg, caption });
      }
    } else {
      // Photo/text carousel attempt — falls back to draft on 400
      try {
        const result = await initPhotoPost(caption);
        if (result === null) {
          // TikTok rejected text-only post; save as draft
          status = "draft";
          publishId = null;
        } else {
          publishId = result.publish_id;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("[mavis-nora-tiktok] Photo post failed:", errMsg);
        return json({ success: false, error: errMsg, caption });
      }
    }

    // Log to mavis_social_posts
    const { error: dbError } = await adminSb.from("mavis_social_posts").insert({
      user_id: userId,
      platform: "tiktok",
      persona: "nora_vale",
      content: caption,
      status,
      external_post_id: publishId ?? null,
      posted_at: status === "posted" ? new Date().toISOString() : null,
    });

    if (dbError) {
      console.error("[mavis-nora-tiktok] DB insert error:", dbError);
    }

    return json({
      success: status === "posted",
      caption,
      publish_id: publishId,
      status,
    });
  } catch (err) {
    console.error("[mavis-nora-tiktok]", err);
    return json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        caption: caption || null,
      },
      500,
    );
  }
});
