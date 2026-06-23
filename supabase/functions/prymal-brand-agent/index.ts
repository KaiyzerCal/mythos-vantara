// prymal-brand-agent — Social media content creation and publishing
//
// Drafts platform-native content using the client's brand voice from their
// knowledge base, queues for approval, and executes publishing when approved.
//
// Required secrets:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   ANTHROPIC_API_KEY
//
// Per-client integrations (provider key in prymal_client_integrations):
//   'instagram' → config: { access_token, ig_user_id }
//   'facebook'  → config: { access_token, page_id }
//   'linkedin'  → config: { access_token, org_urn }  (urn:li:organization:XXXXX)
//   'tiktok'    → config: { access_token, open_id }  (text posts only)
//
// Routes:
//   POST /draft     — draft a post for one or more platforms, queue for approval
//   POST /calendar  — draft a week's content across all connected platforms
//   POST /execute   — called by prymal-approval-flow after owner approves
//   GET  /status    — connected platforms + recent post stats

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLAUDE = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Platform configuration ─────────────────────────────────────────────────
const PLATFORM_CONFIG: Record<string, {
  maxChars: number;
  hashtagCount: number;
  tone: string;
  notes: string;
}> = {
  instagram: {
    maxChars:     2200,
    hashtagCount: 15,
    tone:         "visual, engaging, community-driven",
    notes:        "Hook in the first line. Emojis welcome. End with a question or CTA. Use line breaks for readability.",
  },
  facebook: {
    maxChars:     63206,
    hashtagCount: 3,
    tone:         "conversational, community-focused, informative",
    notes:        "1–3 paragraphs. Fewer hashtags than Instagram. Personal and direct. Links perform well.",
  },
  linkedin: {
    maxChars:     3000,
    hashtagCount: 5,
    tone:         "professional, thought-leadership, value-driven",
    notes:        "Start with an insight or question. Use short paragraphs. End with a takeaway. 3–5 hashtags.",
  },
  tiktok: {
    maxChars:     150,
    hashtagCount: 8,
    tone:         "authentic, energetic, trend-aware",
    notes:        "This is the caption for a TikTok video. Keep it punchy, under 150 chars. Hook immediately. TikTok captions describe the video — assume the video matches the brief.",
  },
};

// ── Client brand context ───────────────────────────────────────────────────
interface ClientContext {
  business_name: string;
  industry: string;
  tone_of_voice: string;
  never_say: string;
  knowledge_base: string;
  target_customer: string;
}

async function loadClientContext(clientId: string): Promise<ClientContext | null> {
  const { data } = await sb
    .from("prymal_clients")
    .select("business_name, industry, tone_of_voice, never_say, knowledge_base, target_customer")
    .eq("id", clientId)
    .single();
  return data as ClientContext | null;
}

// ── Claude: draft a platform-native caption ────────────────────────────────
async function draftCaption(
  brief: string,
  platform: string,
  client: ClientContext,
  existingCaptions: string[] = []
): Promise<{ caption: string; hashtags: string[] }> {
  const pc = PLATFORM_CONFIG[platform] ?? PLATFORM_CONFIG.instagram;

  const avoidDupes = existingCaptions.length > 0
    ? `\nDo NOT duplicate these already-drafted captions for the same campaign:\n${existingCaptions.map((c, i) => `${i + 1}. "${c.slice(0, 100)}..."`).join("\n")}`
    : "";

  const system = `You are a social media copywriter for ${client.business_name}.
Business: ${(client.knowledge_base ?? "").slice(0, 600) || `${client.business_name} — a ${client.industry ?? "local"} business`}
Target customer: ${client.target_customer ?? "general audience"}
Brand tone: ${client.tone_of_voice ?? "professional and approachable"}
${client.never_say ? `Never use these words or phrases: ${client.never_say}` : ""}

You are writing for ${platform.toUpperCase()}.
Platform tone: ${pc.tone}
Platform notes: ${pc.notes}
Max characters: ${pc.maxChars} (stay well under).
Return exactly two lines:
LINE 1: CAPTION: <the caption text only, no hashtags inline>
LINE 2: HASHTAGS: <${pc.hashtagCount} comma-separated hashtags without #, or NONE if platform doesn't use them>
${avoidDupes}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": CLAUDE, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      system,
      messages: [{ role: "user", content: `Write a ${platform} post.\n\nBrief: ${brief}` }],
    }),
    signal: AbortSignal.timeout(22000),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);

  const d  = await res.json();
  const raw = (d.content?.[0]?.text ?? "").trim();

  // Parse the structured response
  const captionMatch  = raw.match(/^CAPTION:\s*(.+?)(?=\nHASHTAGS:|$)/s);
  const hashtagMatch  = raw.match(/HASHTAGS:\s*(.+)$/s);
  const caption  = captionMatch?.[1]?.trim() ?? raw;
  const hashtagRaw = hashtagMatch?.[1]?.trim() ?? "";
  const hashtags = hashtagRaw === "NONE" || !hashtagRaw
    ? []
    : hashtagRaw.split(",").map((h: string) => h.trim().replace(/^#/, "")).filter(Boolean).slice(0, pc.hashtagCount);

  return { caption, hashtags };
}

// ── Platform publishers ────────────────────────────────────────────────────

// Instagram Graph API — requires image or video for a standard post.
// For text/link posts use Facebook Page instead.
// media_urls[0] must be a publicly accessible image URL.
async function publishInstagram(
  cfg: { access_token: string; ig_user_id: string },
  caption: string,
  hashtags: string[],
  mediaUrls: string[]
): Promise<string> {
  const fullCaption = hashtags.length > 0
    ? `${caption}\n\n${hashtags.map(h => `#${h}`).join(" ")}`
    : caption;

  if (!mediaUrls[0]) {
    throw new Error("Instagram requires at least one image URL. Use Facebook for text-only posts.");
  }

  // Step 1: create media container
  const containerRes = await fetch(
    `https://graph.facebook.com/v19.0/${cfg.ig_user_id}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url:    mediaUrls[0],
        caption:      fullCaption,
        access_token: cfg.access_token,
      }),
      signal: AbortSignal.timeout(20000),
    }
  );
  if (!containerRes.ok) throw new Error(`IG container ${containerRes.status}: ${await containerRes.text()}`);
  const container = await containerRes.json();
  if (!container.id) throw new Error(`IG container error: ${JSON.stringify(container)}`);

  // Step 2: publish
  const publishRes = await fetch(
    `https://graph.facebook.com/v19.0/${cfg.ig_user_id}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: container.id, access_token: cfg.access_token }),
      signal: AbortSignal.timeout(20000),
    }
  );
  if (!publishRes.ok) throw new Error(`IG publish ${publishRes.status}: ${await publishRes.text()}`);
  const pub = await publishRes.json();
  return pub.id as string;
}

// Facebook Graph API — page posts, supports text, links, and photos.
async function publishFacebook(
  cfg: { access_token: string; page_id: string },
  caption: string,
  hashtags: string[],
  mediaUrls: string[]
): Promise<string> {
  const message = hashtags.length > 0
    ? `${caption}\n\n${hashtags.map(h => `#${h}`).join(" ")}`
    : caption;

  const postBody: Record<string, string> = {
    message,
    access_token: cfg.access_token,
  };

  // Use /photos endpoint if image is provided, otherwise /feed
  const endpoint = mediaUrls[0]
    ? `https://graph.facebook.com/v19.0/${cfg.page_id}/photos`
    : `https://graph.facebook.com/v19.0/${cfg.page_id}/feed`;
  if (mediaUrls[0]) postBody.url = mediaUrls[0];

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(postBody),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`FB post ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return (d.id ?? d.post_id ?? "") as string;
}

// LinkedIn UGC Posts API — text posts for organizations.
async function publishLinkedIn(
  cfg: { access_token: string; org_urn: string },
  caption: string,
  hashtags: string[],
  mediaUrls: string[]
): Promise<string> {
  const text = hashtags.length > 0
    ? `${caption}\n\n${hashtags.map(h => `#${h}`).join(" ")}`
    : caption;

  const body: Record<string, unknown> = {
    author:         cfg.org_urn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary:    { text },
        shareMediaCategory: mediaUrls.length > 0 ? "IMAGE" : "NONE",
        ...(mediaUrls.length > 0 ? {
          media: mediaUrls.slice(0, 9).map(url => ({
            status: "READY",
            originalUrl: url,
          })),
        } : {}),
      },
    },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
  };

  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${cfg.access_token}`,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`LinkedIn post ${res.status}: ${await res.text()}`);
  return res.headers.get("x-restli-id") ?? "";
}

// TikTok — text-only caption queuing (video upload is a separate complex flow).
// This stores the post as a draft; actual video upload handled separately.
async function publishTikTok(
  cfg: { access_token: string; open_id: string },
  caption: string,
  hashtags: string[],
  mediaUrls: string[]
): Promise<string> {
  if (!mediaUrls[0]) {
    // TikTok requires video — return a queued draft ID
    throw new Error("TikTok requires a video URL. Provide media_urls with a video link to publish.");
  }

  const text = hashtags.length > 0
    ? `${caption} ${hashtags.map(h => `#${h}`).join(" ")}`
    : caption;

  // TikTok Content Posting API v2
  const res = await fetch("https://open.tiktokapis.com/v2/post/publish/content/init/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      Authorization:  `Bearer ${cfg.access_token}`,
    },
    body: JSON.stringify({
      post_info: {
        title:            text.slice(0, 150),
        privacy_level:    "PUBLIC_TO_EVERYONE",
        disable_duet:     false,
        disable_comment:  false,
        disable_stitch:   false,
      },
      source_info: {
        source:    "PULL_FROM_URL",
        video_url: mediaUrls[0],
      },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`TikTok post ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.data?.publish_id ?? "";
}

// ── Dispatch publisher ─────────────────────────────────────────────────────
async function publishToplatform(
  platform: string,
  cfg: Record<string, string>,
  caption: string,
  hashtags: string[],
  mediaUrls: string[]
): Promise<string> {
  switch (platform) {
    case "instagram": return publishInstagram(cfg as any, caption, hashtags, mediaUrls);
    case "facebook":  return publishFacebook(cfg as any, caption, hashtags, mediaUrls);
    case "linkedin":  return publishLinkedIn(cfg as any, caption, hashtags, mediaUrls);
    case "tiktok":    return publishTikTok(cfg as any, caption, hashtags, mediaUrls);
    default: throw new Error(`Unknown platform: ${platform}`);
  }
}

// ── Queue helper ───────────────────────────────────────────────────────────
async function queueForApproval(payload: {
  client_id: string;
  action_summary: string;
  action_payload: Record<string, unknown>;
  draft_content: string;
}): Promise<string> {
  const res = await fetch(`${SB_URL}/functions/v1/prymal-approval-flow`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SB_KEY}` },
    body: JSON.stringify({
      ...payload,
      agent:       "brand",
      action_type: "publish_post",
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`approval-flow ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.item_id as string;
}

// ── Main handler ───────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url       = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const route     = pathParts[pathParts.length - 1];

  // ── GET /status ──────────────────────────────────────────────────────────
  if (req.method === "GET" && route === "status") {
    const clientId = url.searchParams.get("client_id");
    if (!clientId) return json({ error: "client_id required" }, 400);

    const { data: integrations } = await sb
      .from("prymal_client_integrations")
      .select("provider, connected, connected_at")
      .eq("client_id", clientId)
      .in("provider", ["instagram", "facebook", "linkedin", "tiktok"]);

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { count: postsThisWeek } = await sb
      .from("prymal_social_posts")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .gte("created_at", sevenDaysAgo);

    const { count: pendingApproval } = await sb
      .from("prymal_social_posts")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("status", "pending_approval");

    return json({
      platforms: (integrations ?? []).map(i => ({ provider: i.provider, connected: i.connected, connected_at: i.connected_at })),
      posts_this_week:   postsThisWeek ?? 0,
      pending_approval:  pendingApproval ?? 0,
    });
  }

  const body = await req.json().catch(() => ({})) as Record<string, any>;

  // ── POST /draft ──────────────────────────────────────────────────────────
  // Draft a post for one or more platforms, queue each for approval.
  // Body: { client_id, brief, platforms?: string[], media_urls?: string[], scheduled_at?: string }
  if (route === "draft") {
    const { client_id, brief, platforms, media_urls, scheduled_at } = body;
    if (!client_id) return json({ error: "client_id required" }, 400);
    if (!brief)     return json({ error: "brief required (what should this post be about?)" }, 400);

    const client = await loadClientContext(client_id);
    if (!client) return json({ error: "Client not found" }, 404);

    // Determine target platforms
    let targetPlatforms: string[] = platforms ?? [];
    if (targetPlatforms.length === 0) {
      // Default to client's connected platforms
      const { data: integrations } = await sb
        .from("prymal_client_integrations")
        .select("provider")
        .eq("client_id", client_id)
        .eq("connected", true)
        .in("provider", ["instagram", "facebook", "linkedin", "tiktok"]);
      targetPlatforms = (integrations ?? []).map((i: any) => i.provider as string);
    }

    if (targetPlatforms.length === 0) {
      return json({ error: "No platforms specified and no social platforms connected for this client" }, 400);
    }

    const queued: Array<{ platform: string; item_id: string; preview: string }> = [];
    const errors: Array<{ platform: string; error: string }> = [];
    const draftedCaptions: string[] = [];

    for (const platform of targetPlatforms) {
      try {
        const { caption, hashtags } = await draftCaption(brief, platform, client, draftedCaptions);
        draftedCaptions.push(caption);

        // Store in prymal_social_posts
        const { data: postRow } = await sb
          .from("prymal_social_posts")
          .insert({
            client_id,
            platform,
            caption,
            hashtags,
            media_urls: media_urls ?? [],
            status:       "pending_approval",
            scheduled_at: scheduled_at ?? null,
          })
          .select()
          .single();

        const draftContent = hashtags.length > 0
          ? `${caption}\n\n${hashtags.map((h: string) => `#${h}`).join(" ")}`
          : caption;

        const itemId = await queueForApproval({
          client_id,
          action_summary: `${platform.charAt(0).toUpperCase() + platform.slice(1)} post: "${caption.slice(0, 70)}${caption.length > 70 ? "…" : ""}"`,
          action_payload: {
            platform,
            caption,
            hashtags,
            media_urls:  media_urls ?? [],
            scheduled_at: scheduled_at ?? null,
            post_id:      postRow?.id ?? null,
          },
          draft_content: draftContent,
        });

        if (postRow) {
          await sb.from("prymal_social_posts").update({ approval_id: itemId }).eq("id", postRow.id);
        }

        queued.push({ platform, item_id: itemId, preview: caption.slice(0, 120) });
      } catch (err: any) {
        errors.push({ platform, error: err.message });
      }
    }

    return json({ ok: true, queued, errors: errors.length > 0 ? errors : undefined });
  }

  // ── POST /calendar ───────────────────────────────────────────────────────
  // Draft a week's content across all connected platforms (MWF cadence).
  // Body: { client_id, week_theme, platforms?: string[], media_urls_by_slot?: string[][] }
  if (route === "calendar") {
    const { client_id, week_theme, platforms, media_urls_by_slot } = body;
    if (!client_id)   return json({ error: "client_id required" }, 400);
    if (!week_theme)  return json({ error: "week_theme required (the unifying theme for this week's content)" }, 400);

    const client = await loadClientContext(client_id);
    if (!client) return json({ error: "Client not found" }, 404);

    // Target platforms
    let targetPlatforms: string[] = platforms ?? [];
    if (targetPlatforms.length === 0) {
      const { data: integrations } = await sb
        .from("prymal_client_integrations")
        .select("provider")
        .eq("client_id", client_id)
        .eq("connected", true)
        .in("provider", ["instagram", "facebook", "linkedin", "tiktok"]);
      targetPlatforms = (integrations ?? []).map((i: any) => i.provider as string);
    }
    if (targetPlatforms.length === 0) {
      return json({ error: "No platforms specified and no social platforms connected" }, 400);
    }

    // MWF schedule for the coming week
    const now   = new Date();
    const slots = [1, 3, 5].map(dayOffset => {
      const d = new Date(now);
      d.setDate(d.getDate() + dayOffset);
      d.setHours(10, 0, 0, 0);  // 10am local
      return d.toISOString();
    });

    // Slot briefs — riff on theme with different angles
    const slotBriefs = [
      `${week_theme} — value/educational angle (teach something useful)`,
      `${week_theme} — social proof or story angle (real results, behind the scenes)`,
      `${week_theme} — engagement/CTA angle (ask a question or make an offer)`,
    ];

    const allQueued: Array<{ platform: string; slot: number; scheduled_at: string; item_id: string; preview: string }> = [];
    const allErrors: Array<{ platform: string; slot: number; error: string }> = [];

    for (let slotIdx = 0; slotIdx < 3; slotIdx++) {
      const brief       = slotBriefs[slotIdx];
      const scheduledAt = slots[slotIdx];
      const mediaUrls   = media_urls_by_slot?.[slotIdx] ?? [];
      const draftedCaptions: string[] = [];

      for (const platform of targetPlatforms) {
        try {
          const { caption, hashtags } = await draftCaption(brief, platform, client, draftedCaptions);
          draftedCaptions.push(caption);

          const { data: postRow } = await sb
            .from("prymal_social_posts")
            .insert({
              client_id,
              platform,
              caption,
              hashtags,
              media_urls:  mediaUrls,
              status:       "pending_approval",
              scheduled_at: scheduledAt,
            })
            .select()
            .single();

          const draftContent = hashtags.length > 0
            ? `${caption}\n\n${hashtags.map((h: string) => `#${h}`).join(" ")}`
            : caption;

          const itemId = await queueForApproval({
            client_id,
            action_summary: `[Slot ${slotIdx + 1}] ${platform} post: "${caption.slice(0, 60)}${caption.length > 60 ? "…" : ""}"`,
            action_payload: {
              platform,
              caption,
              hashtags,
              media_urls:  mediaUrls,
              scheduled_at: scheduledAt,
              post_id:      postRow?.id ?? null,
            },
            draft_content: draftContent,
          });

          if (postRow) {
            await sb.from("prymal_social_posts").update({ approval_id: itemId }).eq("id", postRow.id);
          }

          allQueued.push({ platform, slot: slotIdx + 1, scheduled_at: scheduledAt, item_id: itemId, preview: caption.slice(0, 100) });
        } catch (err: any) {
          allErrors.push({ platform, slot: slotIdx + 1, error: err.message });
        }
      }
    }

    return json({
      ok:            true,
      week_theme,
      total_queued:  allQueued.length,
      slots_planned: 3,
      platforms:     targetPlatforms,
      queued:        allQueued,
      errors:        allErrors.length > 0 ? allErrors : undefined,
    });
  }

  // ── POST /execute ────────────────────────────────────────────────────────
  // Called by prymal-approval-flow when owner approves a publish_post action.
  if (body.execute === true || route === "execute") {
    const { item_id, payload, client_id } = body;
    if (!item_id)   return json({ error: "item_id required" }, 400);
    if (!client_id) return json({ error: "client_id required" }, 400);

    const { data: item } = await sb
      .from("prymal_approval_queue")
      .select("action_type, draft_content, owner_edit")
      .eq("id", item_id)
      .single();
    if (!item) return json({ error: "Approval item not found" }, 404);

    const platform  = payload?.platform as string;
    const mediaUrls = (payload?.media_urls as string[]) ?? [];
    const postId    = payload?.post_id as string | null;

    if (!platform) return json({ error: "payload.platform is required" }, 400);

    // Resolve final content — owner_edit wins if present
    let finalCaption = (item.owner_edit ?? item.draft_content ?? "").trim();
    let finalHashtags: string[] = (payload?.hashtags as string[]) ?? [];

    // If owner edited, the full text (caption + hashtags) is in owner_edit.
    // Attempt to re-extract hashtags from the edited content.
    if (item.owner_edit) {
      const inlineHashtags = (item.owner_edit.match(/#(\w+)/g) ?? []).map((h: string) => h.slice(1));
      if (inlineHashtags.length > 0) {
        finalCaption  = item.owner_edit.replace(/#\w+/g, "").replace(/\s{2,}/g, "\n").trim();
        finalHashtags = inlineHashtags;
      } else {
        finalCaption  = item.owner_edit.trim();
        finalHashtags = [];
      }
    }

    // Load platform integration config
    const { data: integration } = await sb
      .from("prymal_client_integrations")
      .select("config, connected")
      .eq("client_id", client_id)
      .eq("provider", platform)
      .single();

    if (!integration?.connected) {
      return json({ error: `${platform} is not connected for this client` }, 400);
    }

    let platformPostId: string;
    try {
      platformPostId = await publishToplatform(platform, integration.config, finalCaption, finalHashtags, mediaUrls);
    } catch (err: any) {
      return json({ ok: false, error: err.message }, 500);
    }

    // Update prymal_social_posts
    if (postId) {
      await sb.from("prymal_social_posts").update({
        status:           "published",
        published_at:     new Date().toISOString(),
        platform_post_id: platformPostId,
      }).eq("id", postId);
    }

    return json({
      ok:               true,
      action:           "published_post",
      platform,
      platform_post_id: platformPostId,
    });
  }

  return json({ error: "Unknown route. Valid routes: /draft, /calendar, /execute, /status" }, 404);
});
