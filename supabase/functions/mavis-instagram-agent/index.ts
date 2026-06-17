// mavis-instagram-agent
// Instagram Business / Creator — comments, media, AI reply pipeline.
// Requires: Meta Graph API long-lived token in mavis_user_integrations with provider='instagram'
//           Token must have instagram_basic + instagram_manage_comments permissions
//           ANTHROPIC_API_KEY for AI replies in monitor_comments
//
// Actions: list_media | get_media | get_comments | reply_to_comment | monitor_comments

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_SRK        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const IG_API        = "https://graph.facebook.com/v20.0";

// ── Token management ──────────────────────────────────────────────────────────

async function refreshToken(config: any, sb: any, uid: string): Promise<string> {
  // Instagram long-lived tokens last 60 days; refresh when <7 days remain
  if (config.expires_at && config.expires_at > Date.now() / 1000 + 86400 * 7) {
    return config.access_token;
  }
  const res = await fetch(
    `${IG_API}/refresh_access_token?grant_type=ig_refresh_token&access_token=${config.access_token}`,
  );
  const data = await res.json();
  if (!data.access_token) throw new Error("Instagram token refresh failed: " + JSON.stringify(data).slice(0, 200));
  const newConfig = {
    ...config,
    access_token: data.access_token,
    expires_at:   Math.floor(Date.now() / 1000) + (data.expires_in ?? 5184000),
  };
  await sb.from("mavis_user_integrations")
    .update({ config: newConfig })
    .eq("user_id", uid)
    .eq("provider", "instagram");
  return data.access_token;
}

async function getToken(sb: any, uid: string): Promise<{ token: string; igUserId: string }> {
  const { data } = await sb
    .from("mavis_user_integrations")
    .select("config")
    .eq("user_id", uid)
    .eq("provider", "instagram")
    .single();
  if (!data?.config) {
    throw new Error(
      "Instagram not connected. Go to Integrations and add an Instagram Business connection with instagram_basic and instagram_manage_comments permissions.",
    );
  }
  const token = await refreshToken(data.config, sb, uid);
  return { token, igUserId: String(data.config.instagram_user_id ?? data.config.ig_user_id ?? "") };
}

// ── API request ───────────────────────────────────────────────────────────────

async function igReq(token: string, path: string, method = "GET", params?: Record<string, string>): Promise<any> {
  let url = `${IG_API}/${path.replace(/^\//, "")}`;
  const searchParams = new URLSearchParams({ access_token: token, ...params });

  const res = method === "GET"
    ? await fetch(`${url}?${searchParams}`, { signal: AbortSignal.timeout(15000) })
    : await fetch(url, {
        method,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: searchParams,
        signal: AbortSignal.timeout(15000),
      });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Instagram API ${res.status}: ${err.slice(0, 300)}`);
  }
  return res.json();
}

// ── AI helper ─────────────────────────────────────────────────────────────────

async function callClaude(system: string, user: string, maxTokens = 512): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Claude error: ${JSON.stringify(data?.error).slice(0, 200)}`);
  return data.content?.[0]?.text ?? "";
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

    const action = String(body.action ?? "");
    let token: string;
    let igUserId: string;
    try {
      ({ token, igUserId } = await getToken(adminSb, uid));
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }

    switch (action) {

      case "list_media": {
        const limit  = Math.min(Number(body.limit ?? 10), 50);
        const fields = "id,caption,media_type,media_product_type,timestamp,permalink";
        const data   = await igReq(token, `${igUserId}/media`, "GET", { fields, limit: String(limit) });
        return json({
          media: (data.data ?? []).map((m: any) => ({
            id:         m.id,
            caption:    (m.caption ?? "").slice(0, 300),
            type:       m.media_type,
            product:    m.media_product_type,
            timestamp:  m.timestamp,
            permalink:  m.permalink,
          })),
        });
      }

      case "get_media": {
        const mediaId = String(body.media_id ?? body.id ?? "");
        if (!mediaId) return json({ error: "media_id required" }, 400);
        const fields = "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count";
        const data   = await igReq(token, mediaId, "GET", { fields });
        return json({
          id:             data.id,
          caption:        data.caption ?? "",
          type:           data.media_type,
          product:        data.media_product_type,
          timestamp:      data.timestamp,
          permalink:      data.permalink,
          like_count:     data.like_count,
          comments_count: data.comments_count,
        });
      }

      case "get_comments": {
        const mediaId = String(body.media_id ?? body.id ?? "");
        if (!mediaId) return json({ error: "media_id required" }, 400);
        const limit  = Math.min(Number(body.limit ?? 50), 100);
        const since  = body.since ? new Date(String(body.since)) : null;
        const fields = "id,text,username,timestamp,from,parent_id";
        const data   = await igReq(token, `${mediaId}/comments`, "GET", { fields, limit: String(limit) });
        let comments: any[] = data.data ?? [];

        if (since) {
          comments = comments.filter(c => new Date(c.timestamp) > since);
        }

        return json({
          media_id: mediaId,
          comments: comments.map(c => ({
            id:        c.id,
            text:      c.text ?? "",
            username:  c.username ?? c.from?.username ?? "unknown",
            timestamp: c.timestamp,
            is_reply:  !!c.parent_id,
          })),
          count: comments.length,
        });
      }

      case "reply_to_comment": {
        const commentId = String(body.comment_id ?? body.id ?? "");
        const message   = String(body.message ?? body.text ?? "");
        if (!commentId || !message) return json({ error: "comment_id and message required" }, 400);
        const data = await igReq(token, `${commentId}/replies`, "POST", { message });
        return json({ comment_id: commentId, reply_id: data.id, message });
      }

      case "monitor_comments": {
        // Full pipeline: list recent media → get new comments → AI reply → post reply.
        // Mirrors Make.com: NewComment webhook → GetMedia → AI completion → CreateComment reply.
        const businessName  = String(body.business_name ?? "our brand");
        const replySignature = body.reply_signature ? String(body.reply_signature) : "";
        const mediaLimit    = Math.min(Number(body.media_limit ?? 5), 20);
        const commentsLimit = Math.min(Number(body.comments_per_media ?? 50), 100);
        const autoReply     = body.auto_reply !== false;
        const stateKey      = String(body.state_key ?? "ig_comment_watch_state");
        const skipReplies   = body.skip_replies !== false; // don't reply to reply threads

        // Load last_check watermark
        const { data: stateRow } = await adminSb
          .from("mavis_memory")
          .select("id, content")
          .eq("user_id", uid)
          .contains("tags", [stateKey])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const lastCheckIso: string = stateRow
          ? (JSON.parse(stateRow.content ?? "{}").last_check_iso ?? "")
          : "";

        const nowIso  = new Date().toISOString();
        const sinceDate = lastCheckIso ? new Date(lastCheckIso) : null;

        // 1. List recent media posts
        const mediaFields = "id,caption,media_type,media_product_type,timestamp";
        const mediaData   = await igReq(token, `${igUserId}/media`, "GET", { fields: mediaFields, limit: String(mediaLimit) });
        const mediaPosts: any[] = mediaData.data ?? [];

        const results: any[] = [];
        let totalComments = 0;
        let replied = 0;

        const replySystem =
          `You are a warm, engaging Instagram community manager for ${businessName}.\n` +
          `You respond to comments on the brand's Instagram posts.\n` +
          `Rules:\n` +
          `- Keep the reply under 200 characters\n` +
          `- Be genuine, friendly, and on-brand — not corporate\n` +
          `- For compliments/praise: thank them warmly and add energy\n` +
          `- For questions: answer briefly or invite them to DM for more info\n` +
          `- For negative comments: respond professionally and invite them to DM\n` +
          (replySignature ? `- Sign off with: ${replySignature}\n` : "") +
          `- Do NOT include the @mention — it will be added automatically\n` +
          `- Return ONLY the reply text, no quotes or explanation`;

        for (const media of mediaPosts) {
          try {
            // 2. Get comments on this post
            const cmtFields = "id,text,username,timestamp,from,parent_id";
            const cmtData   = await igReq(token, `${media.id}/comments`, "GET", {
              fields: cmtFields,
              limit:  String(commentsLimit),
            });
            let comments: any[] = cmtData.data ?? [];

            // Filter to new comments since last check
            if (sinceDate) {
              comments = comments.filter(c => new Date(c.timestamp) > sinceDate);
            } else {
              comments = comments.slice(0, 5); // first run: only process last 5
            }

            // Skip replies-to-replies if requested
            if (skipReplies) {
              comments = comments.filter(c => !c.parent_id);
            }

            totalComments += comments.length;

            for (const comment of comments) {
              try {
                const commenter = comment.username ?? comment.from?.username ?? "friend";
                const text      = comment.text ?? "";

                // 3. AI reply — uses post caption for context
                const caption = (media.caption ?? "").slice(0, 500);
                const aiReply = await callClaude(
                  replySystem,
                  `Post caption: ${caption || "(no caption)"}\nPost type: ${media.media_product_type ?? media.media_type ?? "FEED"}\n\nComment by @${commenter}: ${text.slice(0, 500)}`,
                  256,
                );

                // 4. Post reply with @mention prefix
                const message = `@${commenter} ${aiReply.trim()}`;
                let replyId: string | null = null;

                if (autoReply) {
                  const replyData = await igReq(token, `${comment.id}/replies`, "POST", { message });
                  replyId = replyData.id ?? null;
                  replied++;
                }

                results.push({
                  media_id:     media.id,
                  comment_id:   comment.id,
                  commenter,
                  comment_text: text.slice(0, 200),
                  ai_reply:     aiReply,
                  message_sent: message.slice(0, 200),
                  reply_id:     replyId,
                  replied_at:   autoReply ? nowIso : null,
                });
              } catch (e: unknown) {
                results.push({ media_id: media.id, comment_id: comment.id, error: e instanceof Error ? e.message : String(e) });
              }
            }
          } catch (e: unknown) {
            results.push({ media_id: media.id, error: e instanceof Error ? e.message : String(e) });
          }
        }

        // Persist watermark
        const newState = JSON.stringify({ last_check_iso: nowIso, last_run: nowIso });
        if (stateRow) {
          await adminSb.from("mavis_memory").update({ content: newState }).eq("id", (stateRow as any).id);
        } else {
          await adminSb.from("mavis_memory").insert({
            user_id:    uid,
            role:       "assistant",
            content:    newState,
            tags:       [stateKey, "ig_comments", "system_state"],
            importance: 3,
          });
        }

        return json({
          media_checked:  mediaPosts.length,
          new_comments:   totalComments,
          processed:      results.filter(r => !r.error).length,
          replied,
          results,
        });
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: list_media | get_media | get_comments | reply_to_comment | monitor_comments`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-instagram-agent]", message);
    const status = message.includes("not connected") ? 503 : 500;
    return json({ error: message }, status);
  }
});
