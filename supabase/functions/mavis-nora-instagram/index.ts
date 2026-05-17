// MAVIS Nora Instagram — Posts content to Instagram as the Nora Vale persona.
// Supports manual content or AI-generated captions via Claude Haiku.
// Auth: Bearer JWT (user) or service-role (cron).
//
// Required env vars:
//   INSTAGRAM_NORA_ACCESS_TOKEN  — Nora's Meta Graph API access token
//   INSTAGRAM_NORA_USER_ID       — Nora's Instagram Business Account ID
//   ANTHROPIC_API_KEY            — for AI-generated captions
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
const IG_ACCESS_TOKEN = Deno.env.get("INSTAGRAM_NORA_ACCESS_TOKEN") ?? "";
const IG_USER_ID = Deno.env.get("INSTAGRAM_NORA_USER_ID") ?? "";
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

// ── Nora Vale persona for Instagram ──────────────────────────────────────────

const NORA_IG_SYSTEM = `You are Nora Vale — tech-forward business strategist, founder mindset. Write an Instagram caption (max 2200 chars) that drives engagement. Include 8-12 relevant hashtags at end. Authentic, aspirational, not corporate. Can use line breaks for readability.`;

async function generateInstagramCaption(): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: NORA_IG_SYSTEM,
      messages: [
        {
          role: "user",
          content:
            "Generate a post about a key insight from Nora's world of AI automation, revenue systems, and founder strategy.",
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

// ── Meta Graph API helpers ────────────────────────────────────────────────────

async function createMediaContainer(
  caption: string,
  imageUrl?: string,
): Promise<{ id: string }> {
  const params: Record<string, string> = {
    caption,
    access_token: IG_ACCESS_TOKEN,
  };

  if (imageUrl) {
    params.image_url = imageUrl;
  } else {
    params.media_type = "TEXT";
  }

  const url = new URL(
    `https://graph.facebook.com/v18.0/${IG_USER_ID}/media`,
  );

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  const data = await res.json();

  if (!res.ok || data.error) {
    const errMsg = data.error?.message ?? JSON.stringify(data);
    throw new Error(`Meta media container error (${res.status}): ${errMsg}`);
  }

  if (!data.id) throw new Error("Meta API did not return a container id");
  return { id: data.id };
}

async function publishMediaContainer(creationId: string): Promise<{ id: string }> {
  const res = await fetch(
    `https://graph.facebook.com/v18.0/${IG_USER_ID}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: creationId,
        access_token: IG_ACCESS_TOKEN,
      }),
    },
  );

  const data = await res.json();

  if (!res.ok || data.error) {
    const errMsg = data.error?.message ?? JSON.stringify(data);
    throw new Error(`Meta media_publish error (${res.status}): ${errMsg}`);
  }

  if (!data.id) throw new Error("Meta API did not return a published post id");
  return { id: data.id };
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  if (!IG_ACCESS_TOKEN || !IG_USER_ID) {
    return json(
      {
        success: false,
        error:
          "INSTAGRAM_NORA_ACCESS_TOKEN and INSTAGRAM_NORA_USER_ID must be configured",
      },
      400,
    );
  }

  let body: {
    user_id?: string;
    content?: string;
    image_url?: string;
    generate?: boolean;
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
  const imageUrl = body.image_url?.trim() || undefined;

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
      caption = await generateInstagramCaption();
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

    // If no image_url, Instagram does not support text-only posts via the
    // media container API. Return the caption so the operator can post manually.
    if (!imageUrl) {
      console.warn(
        "[mavis-nora-instagram] No image_url provided — Instagram requires an image for media posts. Caption generated and saved as draft.",
      );

      const { error: dbError } = await adminSb.from("mavis_social_posts").insert({
        user_id: userId,
        platform: "instagram",
        persona: "nora_vale",
        content: caption,
        status: "draft",
        external_post_id: null,
        posted_at: null,
      });

      if (dbError) {
        console.error("[mavis-nora-instagram] DB insert error:", dbError);
      }

      return json({
        error: "image_url required for Instagram",
        caption,
        success: false,
      });
    }

    // Step 1: Create media container
    let container: { id: string };
    try {
      container = await createMediaContainer(caption, imageUrl);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[mavis-nora-instagram] Container creation failed:", errMsg);
      return json({ success: false, error: errMsg, caption });
    }

    // Step 2: Wait 2 seconds for Meta to process the container
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Step 3: Publish the container
    let publishRes: { id: string };
    try {
      publishRes = await publishMediaContainer(container.id);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[mavis-nora-instagram] Publish failed:", errMsg);
      return json({ success: false, error: errMsg, caption });
    }

    // Step 4: Log to mavis_social_posts
    const { error: dbError } = await adminSb.from("mavis_social_posts").insert({
      user_id: userId,
      platform: "instagram",
      persona: "nora_vale",
      content: caption,
      status: "posted",
      external_post_id: publishRes.id,
      posted_at: new Date().toISOString(),
    });

    if (dbError) {
      console.error("[mavis-nora-instagram] DB insert error:", dbError);
    }

    return json({ success: true, post_id: publishRes.id, caption });
  } catch (err) {
    console.error("[mavis-nora-instagram]", err);
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
