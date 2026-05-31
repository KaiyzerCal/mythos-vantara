// mavis-nora-engage
// Polls Twitter/X for new mentions and DMs directed at Nora Vale, generates
// in-persona replies via Claude, and posts them back. Designed to run on a cron
// (every 15 minutes). Tracks processed events in nora_engagement_log to avoid
// double-replies.
//
// Required env vars (same creds as mavis-nora-post):
//   TWITTER_API_KEY              — consumer key
//   TWITTER_API_SECRET           — consumer secret
//   TWITTER_NORA_ACCESS_TOKEN    — Nora's account access token
//   TWITTER_NORA_ACCESS_SECRET   — Nora's account access token secret
//   TWITTER_NORA_USER_ID         — Nora's numeric Twitter user ID (preferred)
//   TWITTER_NORA_USERNAME        — fallback handle if user ID not set
//   ANTHROPIC_API_KEY            — for reply generation
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Nora persona ──────────────────────────────────────────────────────────────
const NORA_PERSONA = `You are Nora Vale — a tech-forward business strategist with a founder mindset.
You talk about revenue systems, AI automation, and building leverage.
You're direct, real, never corporate-speak. No fluff, no filler.
When replying to tweet mentions: stay under 260 characters, add genuine value, match the conversation energy.
When replying to DMs: be helpful and personal, 2-3 sentences max.
Never be sycophantic. If someone is hostile, be confident but never combative.
Never reveal you're an AI unless directly asked — and even then, stay in character.`;

// ── OAuth 1.0a helpers ────────────────────────────────────────────────────────

function oauthEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

async function hmacSha1(message: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", encoder.encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  const bytes = new Uint8Array(sig);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Build OAuth 1.0a Authorization header.
 * extraParams: for GET requests include query params here so they're part of signature.
 * For POST with JSON body, leave extraParams empty (body is not form-encoded).
 */
async function buildOAuthHeader(
  method: string,
  baseUrl: string,
  consumerKey: string,
  consumerSecret: string,
  accessToken: string,
  accessSecret: string,
  extraParams: Record<string, string> = {},
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  // Signature base includes both OAuth params AND query params for GET requests
  const allParams = { ...extraParams, ...oauthParams };
  const sortedParams = Object.entries(allParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${oauthEncode(k)}=${oauthEncode(v)}`)
    .join("&");

  const sigBase = [method.toUpperCase(), oauthEncode(baseUrl), oauthEncode(sortedParams)].join("&");
  const sigKey = `${oauthEncode(consumerSecret)}&${oauthEncode(accessSecret)}`;
  const signature = await hmacSha1(sigBase, sigKey);

  const headerParams = { ...oauthParams, oauth_signature: signature };
  const headerParts = Object.entries(headerParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${oauthEncode(k)}="${oauthEncode(v)}"`)
    .join(", ");

  return `OAuth ${headerParts}`;
}

// ── Claude reply generator ────────────────────────────────────────────────────

async function generateReply(
  incomingText: string,
  context: "mention" | "dm",
  anthropicKey: string,
): Promise<string | null> {
  const systemSuffix = context === "dm"
    ? "You're responding to a direct message. Be personal and concise (2-3 sentences)."
    : "You're replying to a public tweet mention. Stay under 260 characters. Be sharp.";

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 120,
        system: `${NORA_PERSONA}\n\n${systemSuffix}`,
        messages: [{ role: "user", content: `Reply to this as Nora Vale:\n\n"${incomingText}"` }],
      }),
    });
    const data = await res.json();
    const text: string = data.content?.[0]?.text?.trim() ?? "";
    if (!text) return null;
    // Hard-cap mentions at 279 chars (leave 1 for safety)
    return context === "mention" ? text.slice(0, 279) : text;
  } catch {
    return null;
  }
}

// ── Post a tweet (reply or standalone) ───────────────────────────────────────

async function postTweet(
  text: string,
  inReplyToId: string | null,
  apiKey: string,
  apiSecret: string,
  accessToken: string,
  accessSecret: string,
): Promise<{ ok: boolean; tweet_id: string | null; error?: string }> {
  const url = "https://api.twitter.com/2/tweets";
  const payload: Record<string, unknown> = { text };
  if (inReplyToId) payload.reply = { in_reply_to_tweet_id: inReplyToId };

  const auth = await buildOAuthHeader("POST", url, apiKey, apiSecret, accessToken, accessSecret);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, tweet_id: null, error: JSON.stringify(data).slice(0, 300) };
  return { ok: true, tweet_id: data?.data?.id ?? null };
}

// ── Send a DM reply in an existing conversation ───────────────────────────────

async function sendDmReply(
  conversationId: string,
  text: string,
  apiKey: string,
  apiSecret: string,
  accessToken: string,
  accessSecret: string,
): Promise<{ ok: boolean; dm_event_id: string | null; error?: string }> {
  const url = `https://api.twitter.com/2/dm_conversations/${conversationId}/messages`;
  const auth = await buildOAuthHeader("POST", url, apiKey, apiSecret, accessToken, accessSecret);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, dm_event_id: null, error: JSON.stringify(data).slice(0, 300) };
  return { ok: true, dm_event_id: data?.data?.dm_event_id ?? null };
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const API_KEY    = Deno.env.get("TWITTER_API_KEY");
  const API_SECRET = Deno.env.get("TWITTER_API_SECRET");
  const ACC_TOKEN  = Deno.env.get("TWITTER_NORA_ACCESS_TOKEN");
  const ACC_SECRET = Deno.env.get("TWITTER_NORA_ACCESS_SECRET");
  const ANTHROPIC  = Deno.env.get("ANTHROPIC_API_KEY")!;

  if (!API_KEY || !API_SECRET || !ACC_TOKEN || !ACC_SECRET) {
    return new Response(JSON.stringify({ skipped: "Twitter credentials not configured" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const results = {
    mentions_checked: 0,
    dms_checked: 0,
    replies_posted: 0,
    errors: [] as string[],
  };

  // ── Resolve Nora's Twitter user ID ─────────────────────────────────────────

  let noraUserId = Deno.env.get("TWITTER_NORA_USER_ID") ?? "";

  if (!noraUserId) {
    const username = Deno.env.get("TWITTER_NORA_USERNAME") ?? "";
    if (!username) {
      return new Response(
        JSON.stringify({ error: "Set TWITTER_NORA_USER_ID or TWITTER_NORA_USERNAME in Supabase secrets" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const lookupBase = `https://api.twitter.com/2/users/by/username/${username}`;
    const lookupAuth = await buildOAuthHeader("GET", lookupBase, API_KEY, API_SECRET, ACC_TOKEN, ACC_SECRET);
    const lookupRes = await fetch(lookupBase, { headers: { Authorization: lookupAuth } });
    const lookupData = await lookupRes.json();
    noraUserId = lookupData?.data?.id ?? "";
    if (!noraUserId) {
      return new Response(
        JSON.stringify({ error: "Could not resolve Nora's Twitter user ID", detail: lookupData }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  // ── Poll mentions ───────────────────────────────────────────────────────────

  try {
    // Find the newest mention we've already seen to use as since_id
    const { data: lastSeen } = await supabase
      .from("nora_engagement_log")
      .select("source_id")
      .eq("type", "mention")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const mentionsBase = `https://api.twitter.com/2/users/${noraUserId}/mentions`;
    const mentionsQuery: Record<string, string> = {
      max_results: "10",
      "tweet.fields": "text,author_id,created_at,conversation_id",
      expansions: "author_id",
    };
    if (lastSeen?.source_id) mentionsQuery.since_id = lastSeen.source_id;

    const mentionsFullUrl = `${mentionsBase}?${new URLSearchParams(mentionsQuery)}`;
    const mentionsAuth = await buildOAuthHeader("GET", mentionsBase, API_KEY, API_SECRET, ACC_TOKEN, ACC_SECRET, mentionsQuery);
    const mentionsRes = await fetch(mentionsFullUrl, { headers: { Authorization: mentionsAuth } });
    const mentionsData = await mentionsRes.json();

    if (!mentionsRes.ok) {
      results.errors.push(`Mentions API ${mentionsRes.status}: ${JSON.stringify(mentionsData).slice(0, 200)}`);
    } else if (Array.isArray(mentionsData.data)) {
      for (const mention of mentionsData.data as Array<{ id: string; text: string; author_id: string; conversation_id: string }>) {
        results.mentions_checked++;

        // Skip if we've already logged this mention
        const { data: existing } = await supabase
          .from("nora_engagement_log")
          .select("id")
          .eq("source_id", mention.id)
          .maybeSingle();
        if (existing) continue;

        // Skip if the mention is from Nora herself
        if (mention.author_id === noraUserId) continue;

        const replyText = await generateReply(mention.text, "mention", ANTHROPIC);
        if (!replyText) {
          await supabase.from("nora_engagement_log").insert({
            type: "mention", source_id: mention.id, source_author_id: mention.author_id,
            source_text: mention.text, reply_text: null, status: "skipped",
          });
          continue;
        }

        const post = await postTweet(replyText, mention.id, API_KEY, API_SECRET, ACC_TOKEN, ACC_SECRET);

        await supabase.from("nora_engagement_log").insert({
          type: "mention",
          source_id: mention.id,
          source_author_id: mention.author_id,
          source_text: mention.text,
          reply_text: replyText,
          reply_id: post.tweet_id,
          status: post.ok ? "replied" : "failed",
          error: post.error ?? null,
        });

        if (post.ok) results.replies_posted++;
        else results.errors.push(`Reply to ${mention.id} failed: ${post.error}`);

        // Respect Twitter rate limits — 1 write per second on free tier
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
  } catch (err: any) {
    results.errors.push(`Mentions poll error: ${err.message}`);
  }

  // ── Poll DMs ────────────────────────────────────────────────────────────────

  try {
    const dmBase = "https://api.twitter.com/2/dm_events";
    const dmQuery: Record<string, string> = {
      event_types: "MessageCreate",
      "dm_event.fields": "id,text,sender_id,created_at,dm_conversation_id",
      max_results: "5",
    };

    const { data: lastDm } = await supabase
      .from("nora_engagement_log")
      .select("source_id")
      .eq("type", "dm")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastDm?.source_id) dmQuery.since_id = lastDm.source_id;

    const dmFullUrl = `${dmBase}?${new URLSearchParams(dmQuery)}`;
    const dmAuth = await buildOAuthHeader("GET", dmBase, API_KEY, API_SECRET, ACC_TOKEN, ACC_SECRET, dmQuery);
    const dmRes = await fetch(dmFullUrl, { headers: { Authorization: dmAuth } });
    const dmData = await dmRes.json();

    if (!dmRes.ok) {
      // DM API may not be available on free tier — log softly, don't error
      results.errors.push(`DM API ${dmRes.status}: ${JSON.stringify(dmData).slice(0, 200)}`);
    } else if (Array.isArray(dmData.data)) {
      for (const event of dmData.data as Array<{ id: string; text: string; sender_id: string; dm_conversation_id: string }>) {
        results.dms_checked++;

        if (event.sender_id === noraUserId) continue;

        const { data: existing } = await supabase
          .from("nora_engagement_log")
          .select("id")
          .eq("source_id", event.id)
          .maybeSingle();
        if (existing) continue;

        const replyText = await generateReply(event.text, "dm", ANTHROPIC);
        if (!replyText) {
          await supabase.from("nora_engagement_log").insert({
            type: "dm", source_id: event.id, source_author_id: event.sender_id,
            source_text: event.text, reply_text: null, status: "skipped",
          });
          continue;
        }

        const dm = await sendDmReply(event.dm_conversation_id, replyText, API_KEY, API_SECRET, ACC_TOKEN, ACC_SECRET);

        await supabase.from("nora_engagement_log").insert({
          type: "dm",
          source_id: event.id,
          source_author_id: event.sender_id,
          source_text: event.text,
          reply_text: replyText,
          reply_id: dm.dm_event_id,
          status: dm.ok ? "replied" : "failed",
          error: dm.error ?? null,
        });

        if (dm.ok) results.replies_posted++;
        else results.errors.push(`DM reply failed: ${dm.error}`);

        await new Promise((r) => setTimeout(r, 1200));
      }
    }
  } catch (err: any) {
    results.errors.push(`DM poll error: ${err.message}`);
  }

  return new Response(JSON.stringify({ ok: true, ...results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
