// mavis-persona-social
// Unified multi-persona social media agent.
// Personas are configured in `mavis_social_personas` DB table.
//
// Actions: upsert_persona | get_persona | list_personas
//          generate_post | schedule_post | post_now | process_scheduled | list_posts
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   ANTHROPIC_API_KEY
//   TWITTER_API_KEY, TWITTER_API_SECRET        — global consumer key/secret
//   {cred_prefix}_ACCESS_TOKEN                 — per-persona Twitter/LinkedIn token
//   {cred_prefix}_ACCESS_SECRET                — per-persona Twitter token secret
//   {cred_prefix}_AUTHOR_URN                   — per-persona LinkedIn author URN (optional)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ─────────────────────────────────────────────────────────────
// OAUTH 1.0a HELPERS (verbatim from mavis-nora-post)
// ─────────────────────────────────────────────────────────────

function oauthEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => {
    return "%" + c.charCodeAt(0).toString(16).toUpperCase();
  });
}

async function hmacSha1(message: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  const bytes = new Uint8Array(signature);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function buildOAuthHeader(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  accessToken: string,
  accessSecret: string,
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  const sortedParams = Object.entries(oauthParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${oauthEncode(k)}=${oauthEncode(v)}`)
    .join("&");

  const signatureBaseString = [
    method.toUpperCase(),
    oauthEncode(url),
    oauthEncode(sortedParams),
  ].join("&");

  const signingKey = `${oauthEncode(consumerSecret)}&${oauthEncode(accessSecret)}`;
  const signature = await hmacSha1(signatureBaseString, signingKey);

  const headerParams: Record<string, string> = {
    ...oauthParams,
    oauth_signature: signature,
  };

  const headerParts = Object.entries(headerParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${oauthEncode(k)}="${oauthEncode(v)}"`)
    .join(", ");

  return `OAuth ${headerParts}`;
}

function truncateAtWord(text: string, maxLen = 280): string {
  if (text.length <= maxLen) return text;
  const cutoff = text.lastIndexOf(" ", maxLen - 1);
  const end = cutoff > 0 ? cutoff : maxLen - 1;
  return text.slice(0, end) + "…";
}

// ─────────────────────────────────────────────────────────────
// PLATFORM POSTERS
// ─────────────────────────────────────────────────────────────

async function postToTwitter(content: string, credPrefix: string): Promise<string> {
  const accessToken  = Deno.env.get(`${credPrefix}_ACCESS_TOKEN`) ?? "";
  const accessSecret = Deno.env.get(`${credPrefix}_ACCESS_SECRET`) ?? "";
  const apiKey       = Deno.env.get("TWITTER_API_KEY") ?? "";
  const apiSecret    = Deno.env.get("TWITTER_API_SECRET") ?? "";

  if (!accessToken || !accessSecret || !apiKey || !apiSecret) {
    throw new Error(
      `Twitter credentials not configured for prefix: ${credPrefix}. Set ${credPrefix}_ACCESS_TOKEN and ${credPrefix}_ACCESS_SECRET in Supabase secrets.`,
    );
  }

  const url = "https://api.twitter.com/2/tweets";
  const authHeader = await buildOAuthHeader("POST", url, apiKey, apiSecret, accessToken, accessSecret);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ text: truncateAtWord(content, 280) }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const e = await res.text();
    throw new Error(`Twitter ${res.status}: ${e.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.data?.id ?? "";
}

async function postToLinkedIn(
  content: string,
  credPrefix: string,
  sb: ReturnType<typeof createClient>,
  userId: string,
): Promise<string> {
  let token      = Deno.env.get(`${credPrefix}_ACCESS_TOKEN`) ?? "";
  let authorUrn  = Deno.env.get(`${credPrefix}_AUTHOR_URN`) ?? "";

  if (!token) {
    const { data } = await sb
      .from("mavis_oauth_tokens")
      .select("access_token, metadata")
      .eq("user_id", userId)
      .eq("provider", "linkedin")
      .single();
    token     = data?.access_token ?? "";
    authorUrn = data?.metadata?.author_urn ?? "";
  }

  if (!token) {
    throw new Error(`LinkedIn not connected for prefix: ${credPrefix}`);
  }

  const body = {
    author: authorUrn || `urn:li:person:${credPrefix}`,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text: content },
        shareMediaCategory: "NONE",
      },
    },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
  };

  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const e = await res.text();
    throw new Error(`LinkedIn ${res.status}: ${e.slice(0, 200)}`);
  }

  return res.headers.get("x-restli-id") ?? "";
}

async function dispatchToplatform(
  platform: string,
  content: string,
  credPrefix: string,
  sb: ReturnType<typeof createClient>,
  userId: string,
): Promise<string> {
  switch (platform) {
    case "twitter":
      return postToTwitter(content, credPrefix);
    case "linkedin":
      return postToLinkedIn(content, credPrefix, sb, userId);
    case "instagram":
    case "tiktok":
      throw new Error(
        "Instagram/TikTok posting requires media — use schedule_post and upload via the mobile app for now.",
      );
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

// ─────────────────────────────────────────────────────────────
// CONTENT GENERATION
// ─────────────────────────────────────────────────────────────

async function generateWithClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${data.error?.message ?? JSON.stringify(data).slice(0, 200)}`);
  }

  return data.content?.[0]?.text ?? "";
}

function buildSystemPrompt(persona: any, platform: string): string {
  const platformCfg  = persona.platforms?.[platform] ?? {};
  const postFmtCfg   = persona.post_formats?.[platform] ?? {};
  const topics       = Array.isArray(persona.topics) ? persona.topics.join(", ") : (persona.topics ?? "");

  const fmtInstructions: string[] = [];
  if (postFmtCfg.max_chars) fmtInstructions.push(`Max characters: ${postFmtCfg.max_chars}`);
  if (postFmtCfg.hashtags !== undefined) {
    fmtInstructions.push(
      postFmtCfg.hashtags ? "Include relevant hashtags." : "Do not use hashtags.",
    );
  }
  if (postFmtCfg.emoji !== undefined) {
    fmtInstructions.push(
      postFmtCfg.emoji ? "Use emoji where appropriate." : "Do not use emoji.",
    );
  }

  return [
    `You are ${persona.display_name}. ${persona.bio ?? ""}`,
    "",
    `Voice: ${persona.voice ?? ""}`,
    `Topics you cover: ${topics}`,
    `Tone: ${persona.tone ?? ""}`,
    `Platform style for ${platform}: ${platformCfg.style ?? ""}`,
    fmtInstructions.length > 0 ? fmtInstructions.join(" ") : "",
    "",
    `Write ONE ${platform} post. Return ONLY the post text — no quotes, no commentary, no meta-text.`,
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), {
      status: s,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${SB_SRK}` && !authHeader.startsWith("Bearer eyJ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body   = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    const sb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });

    // Resolve userId — from body or JWT
    let userId: string = body.userId ?? body.user_id ?? "";
    if (!userId && authHeader.startsWith("Bearer eyJ")) {
      const { data: { user } } = await sb.auth.getUser(authHeader.replace("Bearer ", ""));
      userId = user?.id ?? "";
    }

    // ── Helpers ──────────────────────────────────────────────

    async function loadPersona(personaName: string): Promise<any> {
      if (!userId) throw new Error("userId required");
      if (!personaName) throw new Error("persona_name required");
      const { data, error } = await sb
        .from("mavis_social_personas")
        .select("*")
        .eq("user_id", userId)
        .eq("persona_name", personaName)
        .single();
      if (error || !data) throw new Error(`Persona not found: ${personaName}`);
      return data;
    }

    async function generatePostContent(
      persona: any,
      platform: string,
      prompt?: string,
      topic?: string,
    ): Promise<string> {
      const systemPrompt = buildSystemPrompt(persona, platform);
      const userPrompt   = prompt
        ? prompt
        : topic
        ? `Write a post about: ${topic}`
        : "Write a post on one of your core topics.";
      return generateWithClaude(systemPrompt, userPrompt);
    }

    async function savePost(fields: {
      user_id: string;
      persona_id: string;
      platform: string;
      content: string;
      status: string;
      scheduled_at?: string;
      posted_at?: string;
      external_id?: string;
      error?: string;
      metadata?: Record<string, unknown>;
    }): Promise<string> {
      const { data, error } = await sb
        .from("mavis_social_posts")
        .insert(fields)
        .select("id")
        .single();
      if (error) throw new Error(`DB insert failed: ${error.message}`);
      return data.id;
    }

    async function updatePost(
      postId: string,
      fields: Partial<{
        status: string;
        posted_at: string;
        external_id: string;
        error: string;
      }>,
    ): Promise<void> {
      const { error } = await sb.from("mavis_social_posts").update(fields).eq("id", postId);
      if (error) console.error("[mavis-persona-social] update post error:", error.message);
    }

    // ── Actions ──────────────────────────────────────────────

    switch (action) {
      // ── Persona management ──────────────────────────────

      case "upsert_persona": {
        if (!userId) return json({ error: "userId required" }, 400);
        if (!body.persona_name) return json({ error: "persona_name required" }, 400);

        const { data, error } = await sb
          .from("mavis_social_personas")
          .upsert(
            {
              user_id:      userId,
              persona_name: body.persona_name,
              display_name: body.display_name ?? body.persona_name,
              bio:          body.bio,
              voice:        body.voice,
              topics:       body.topics,
              tone:         body.tone,
              platforms:    body.platforms ?? {},
              post_formats: body.post_formats ?? {},
              active:       body.active ?? true,
              metadata:     body.metadata,
            },
            { onConflict: "user_id,persona_name" },
          )
          .select("id")
          .single();

        if (error) throw new Error(`upsert failed: ${error.message}`);
        return json({ ok: true, persona_id: data.id });
      }

      case "get_persona": {
        if (!userId) return json({ error: "userId required" }, 400);
        const persona = await loadPersona(body.persona_name);
        return json(persona);
      }

      case "list_personas": {
        if (!userId) return json({ error: "userId required" }, 400);
        const { data, error } = await sb
          .from("mavis_social_personas")
          .select("*")
          .eq("user_id", userId)
          .eq("active", true)
          .order("created_at", { ascending: true });
        if (error) throw new Error(error.message);
        return json({ personas: data ?? [] });
      }

      // ── Content generation ───────────────────────────────

      case "generate_post": {
        if (!userId) return json({ error: "userId required" }, 400);
        const platform = String(body.platform ?? "");
        if (!platform) return json({ error: "platform required" }, 400);

        const persona = await loadPersona(body.persona_name);

        const platformCfg = persona.platforms?.[platform];
        if (!platformCfg?.enabled) {
          return json({ error: `Platform '${platform}' not enabled for persona '${body.persona_name}'` }, 400);
        }

        const content = await generatePostContent(persona, platform, body.prompt, body.topic);

        const postId = await savePost({
          user_id:    userId,
          persona_id: persona.id,
          platform,
          content,
          status:     "draft",
        });

        return json({ ok: true, post_id: postId, content, platform, persona_name: body.persona_name });
      }

      case "schedule_post": {
        if (!userId) return json({ error: "userId required" }, 400);
        const platform     = String(body.platform ?? "");
        const content      = String(body.content ?? "");
        const scheduledAt  = String(body.scheduled_at ?? "");
        if (!platform)    return json({ error: "platform required" }, 400);
        if (!content)     return json({ error: "content required" }, 400);
        if (!scheduledAt) return json({ error: "scheduled_at required" }, 400);

        const persona = await loadPersona(body.persona_name);

        const postId = await savePost({
          user_id:      userId,
          persona_id:   persona.id,
          platform,
          content,
          status:       "scheduled",
          scheduled_at: scheduledAt,
        });

        return json({ ok: true, post_id: postId });
      }

      case "post_now": {
        if (!userId) return json({ error: "userId required" }, 400);
        const platform = String(body.platform ?? "");
        if (!platform) return json({ error: "platform required" }, 400);

        const persona = await loadPersona(body.persona_name);

        const platformCfg = persona.platforms?.[platform];
        if (!platformCfg?.enabled) {
          return json({ error: `Platform '${platform}' not enabled for persona '${body.persona_name}'` }, 400);
        }

        const credPrefix = platformCfg.cred_prefix ?? "";

        let content = String(body.content ?? "");
        if (!content) {
          content = await generatePostContent(persona, platform, body.prompt, body.topic);
        }

        const postId = await savePost({
          user_id:    userId,
          persona_id: persona.id,
          platform,
          content,
          status:     "draft",
        });

        let externalId = "";
        try {
          externalId = await dispatchToplatform(platform, content, credPrefix, sb, userId);
          await updatePost(postId, {
            status:      "posted",
            posted_at:   new Date().toISOString(),
            external_id: externalId,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await updatePost(postId, { status: "failed", error: msg });
          throw err;
        }

        return json({ ok: true, post_id: postId, external_id: externalId, platform });
      }

      case "process_scheduled": {
        const filterUserId: string | undefined = body.userId ?? body.user_id;

        let query = sb
          .from("mavis_social_posts")
          .select("*, mavis_social_personas!inner(platforms, display_name, bio, voice, topics, tone, post_formats, persona_name)")
          .eq("status", "scheduled")
          .lte("scheduled_at", new Date().toISOString());

        if (filterUserId) {
          query = query.eq("user_id", filterUserId);
        }

        const { data: posts, error } = await query;
        if (error) throw new Error(`Query failed: ${error.message}`);

        let processed = 0;
        let failed    = 0;

        for (const post of posts ?? []) {
          const persona    = post.mavis_social_personas;
          const platform   = post.platform;
          const platformCfg = persona?.platforms?.[platform];
          const credPrefix  = platformCfg?.cred_prefix ?? "";

          try {
            const externalId = await dispatchToplatform(
              platform,
              post.content,
              credPrefix,
              sb,
              post.user_id,
            );
            await updatePost(post.id, {
              status:      "posted",
              posted_at:   new Date().toISOString(),
              external_id: externalId,
            });
            processed++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await updatePost(post.id, { status: "failed", error: msg });
            console.error(`[mavis-persona-social] process_scheduled post ${post.id}:`, msg);
            failed++;
          }
        }

        return json({ ok: true, processed, failed });
      }

      case "list_posts": {
        if (!userId) return json({ error: "userId required" }, 400);

        let query = sb
          .from("mavis_social_posts")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(Math.min(Number(body.limit ?? 50), 50));

        if (body.persona_name) {
          const { data: persona } = await sb
            .from("mavis_social_personas")
            .select("id")
            .eq("user_id", userId)
            .eq("persona_name", body.persona_name)
            .single();
          if (persona) query = query.eq("persona_id", persona.id);
        }

        if (body.platform) query = query.eq("platform", body.platform);
        if (body.status)   query = query.eq("status", body.status);

        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return json({ posts: data ?? [] });
      }

      default:
        return json(
          {
            error: `Unknown action: ${action}. Use: upsert_persona | get_persona | list_personas | generate_post | schedule_post | post_now | process_scheduled | list_posts`,
          },
          400,
        );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-persona-social]", message);
    return json({ error: message }, message.includes("not configured") || message.includes("not connected") ? 503 : 500);
  }
});
