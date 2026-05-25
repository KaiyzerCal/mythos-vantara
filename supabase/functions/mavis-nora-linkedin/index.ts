// MAVIS Nora LinkedIn — Posts content to LinkedIn as the Nora Vale persona.
// Supports manual content or AI-generated posts via Claude Haiku.
// Auth: Bearer JWT (user) or service-role (cron).
//
// Required env vars:
//   LINKEDIN_NORA_ACCESS_TOKEN  — Nora's LinkedIn OAuth access token
//   ANTHROPIC_API_KEY           — for AI-generated posts
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LINKEDIN_TOKEN = Deno.env.get("LINKEDIN_NORA_ACCESS_TOKEN") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

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
  // Service-role calls pass user_id in the body — handled at call site
  try {
    const { data } = await adminSb.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ── Nora Vale persona for LinkedIn ───────────────────────────────────────────

const NORA_SYSTEM = `You are Nora Vale — tech-forward business strategist, founder mindset, talks about revenue systems and AI automation. Write a LinkedIn post (max 1300 chars) that adds genuine value. Professional but not corporate. No emojis overload. 2-3 paragraphs.`;

async function generateLinkedInPost(): Promise<string> {
  const topics = [
    "how AI automation is reshaping revenue operations for founders",
    "the hidden leverage most business owners leave on the table",
    "why most 'growth hacks' fail and what actually compounds",
    "building systems that generate revenue while you sleep",
    "the real cost of doing everything manually in your business",
    "how to think about AI as a business multiplier, not just a tool",
    "the difference between busy and productive in the founder journey",
    "pricing psychology and why founders consistently underprice themselves",
  ];
  const topic = topics[Math.floor(Math.random() * topics.length)];

  const userMsg = `Write a LinkedIn post sharing a genuine insight about: ${topic}`;

  // Tier 0 — Free Gemini
  if (LOVABLE_KEY) {
    try {
      const lvRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_KEY}` },
        body: JSON.stringify({ model: "google/gemini-2.5-flash", max_tokens: 512, messages: [{ role: "system", content: NORA_SYSTEM }, { role: "user", content: userMsg }] }),
      });
      if (lvRes.ok) { const d = await lvRes.json(); const t: string = d.choices?.[0]?.message?.content?.trim() ?? ""; if (t) return t.slice(0, 1300); }
    } catch { /* fall through */ }
  }
  // Tier 1 — Claude Haiku (designated)
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 512, system: NORA_SYSTEM, messages: [{ role: "user", content: userMsg }] }),
  });

  if (!res.ok) { const err = await res.text(); throw new Error(`Anthropic API error (${res.status}): ${err}`); }
  const data = await res.json();
  const text: string = data.content?.[0]?.text?.trim() ?? "";
  if (!text) throw new Error("Empty response from Claude");
  return text.slice(0, 1300);
}

// ── LinkedIn API helpers ──────────────────────────────────────────────────────

async function getLinkedInPersonId(): Promise<string> {
  const res = await fetch("https://api.linkedin.com/v2/me", {
    headers: {
      Authorization: `Bearer ${LINKEDIN_TOKEN}`,
      "X-Restli-Protocol-Version": "2.0.0",
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LinkedIn /me error (${res.status}): ${err}`);
  }
  const data = await res.json();
  const id: string = data.id;
  if (!id) throw new Error("LinkedIn /me did not return an id");
  return id;
}

async function postToLinkedIn(
  authorUrn: string,
  content: string,
): Promise<{ id: string }> {
  const body = {
    author: authorUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text: content },
        shareMediaCategory: "NONE",
      },
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
    },
  };

  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LINKEDIN_TOKEN}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LinkedIn ugcPosts error (${res.status}): ${err}`);
  }

  const data = await res.json();
  // LinkedIn returns the URN in the id field, e.g. "urn:li:ugcPost:123456"
  return { id: data.id ?? data.value ?? "unknown" };
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  if (!LINKEDIN_TOKEN) {
    return json({ success: false, error: "LINKEDIN_NORA_ACCESS_TOKEN is not configured" }, 400);
  }

  let body: { user_id?: string; content?: string; generate?: boolean };
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
  if (!userId) return json({ error: "Unauthorized — provide user_id or a valid Bearer JWT" }, 401);

  const shouldGenerate = body.generate === true || !body.content?.trim();
  let content = body.content?.trim() ?? "";

  try {
    if (shouldGenerate) {
      if (!ANTHROPIC_KEY) {
        return json({ success: false, error: "ANTHROPIC_API_KEY is not configured for generation" }, 400);
      }
      content = await generateLinkedInPost();
    }

    if (!content) {
      return json({ success: false, error: "No content provided and generation was not requested" }, 400);
    }

    // Get Nora's LinkedIn person ID and build URN
    const personId = await getLinkedInPersonId();
    const authorUrn = `urn:li:person:${personId}`;

    // Post to LinkedIn
    const { id: postId } = await postToLinkedIn(authorUrn, content);

    // Log to mavis_social_posts
    const { error: dbError } = await adminSb.from("mavis_social_posts").insert({
      user_id: userId,
      platform: "linkedin",
      persona: "nora_vale",
      content,
      status: "posted",
      external_post_id: postId,
      posted_at: new Date().toISOString(),
    });

    if (dbError) {
      console.error("[mavis-nora-linkedin] DB insert error:", dbError);
    }

    return json({ success: true, post_id: postId, content });
  } catch (err) {
    console.error("[mavis-nora-linkedin]", err);
    return json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
