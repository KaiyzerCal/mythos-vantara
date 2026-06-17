// mavis-twitter-agent
// Twitter / X API v2 — post tweets, read timeline, search, reply, delete.
// Requires: TWITTER_API_KEY, TWITTER_API_SECRET,
//           TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET
// (All four from a Twitter Developer App with Read+Write permissions
//  and a user Access Token for the account you want to post as.)
//
// Actions: post_tweet | reply_tweet | delete_tweet | get_tweet
//          get_timeline | search_tweets | like_tweet | retweet
//          get_me | upload_media

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_SRK        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_KEY       = Deno.env.get("TWITTER_API_KEY") ?? "";
const API_SECRET    = Deno.env.get("TWITTER_API_SECRET") ?? "";
const ACCESS_TOKEN  = Deno.env.get("TWITTER_ACCESS_TOKEN") ?? "";
const TOKEN_SECRET  = Deno.env.get("TWITTER_ACCESS_SECRET") ?? "";
const BEARER_TOKEN  = Deno.env.get("TWITTER_BEARER_TOKEN") ?? "";
const TW_BASE       = "https://api.twitter.com/2";

// ── OAuth 1.0a signing ─────────────────────────────────────────

function requireTwitter() {
  if (!API_KEY || !API_SECRET || !ACCESS_TOKEN || !TOKEN_SECRET) {
    throw new Error("Twitter not configured. Set TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET in Supabase secrets.");
  }
}

async function hmacSha1(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function buildOAuthHeader(
  method: string,
  url: string,
  extraParams: Record<string, string> = {},
): Promise<string> {
  const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  const ts    = String(Math.floor(Date.now() / 1000));

  const oauthParams: Record<string, string> = {
    oauth_consumer_key:     API_KEY,
    oauth_nonce:            nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp:        ts,
    oauth_token:            ACCESS_TOKEN,
    oauth_version:          "1.0",
  };

  // Combine OAuth params + extra params (e.g. query string fields) for signing
  const allParams = { ...extraParams, ...oauthParams };
  const paramStr = Object.entries(allParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const base  = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(paramStr)}`;
  const key   = `${encodeURIComponent(API_SECRET)}&${encodeURIComponent(TOKEN_SECRET)}`;
  const sig   = await hmacSha1(key, base);

  oauthParams.oauth_signature = sig;

  const header = Object.entries(oauthParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
    .join(", ");

  return `OAuth ${header}`;
}

// ── API request helpers ────────────────────────────────────────

async function tPost(path: string, body: unknown): Promise<any> {
  requireTwitter();
  const url     = `${TW_BASE}${path}`;
  const auth    = await buildOAuthHeader("POST", url);
  const res     = await fetch(url, {
    method:  "POST",
    headers: { "Authorization": auth, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  if (res.status === 204) return { success: true };
  const data = await res.json();
  if (!res.ok) throw new Error(`Twitter error (${res.status}): ${data.detail ?? data.errors?.[0]?.message ?? JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function tDelete(path: string): Promise<any> {
  requireTwitter();
  const url  = `${TW_BASE}${path}`;
  const auth = await buildOAuthHeader("DELETE", url);
  const res  = await fetch(url, { method: "DELETE", headers: { "Authorization": auth } });
  if (res.status === 204) return { success: true };
  const data = await res.json();
  if (!res.ok) throw new Error(`Twitter error (${res.status}): ${data.detail ?? JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function tGet(path: string, qs: Record<string, string> = {}): Promise<any> {
  requireTwitter();
  const url    = `${TW_BASE}${path}`;
  const auth   = await buildOAuthHeader("GET", url, qs);
  const full   = Object.keys(qs).length ? `${url}?${new URLSearchParams(qs)}` : url;
  const res    = await fetch(full, { headers: { "Authorization": auth } });
  const data   = await res.json();
  if (!res.ok) throw new Error(`Twitter error (${res.status}): ${data.detail ?? JSON.stringify(data).slice(0, 200)}`);
  return data;
}

// Bearer token GET — for public search (no user context needed)
async function tBearer(path: string, qs: Record<string, string> = {}): Promise<any> {
  const token = BEARER_TOKEN;
  if (!token) return tGet(path, qs);  // fall back to OAuth

  const url = `${TW_BASE}${path}`;
  const full = Object.keys(qs).length ? `${url}?${new URLSearchParams(qs)}` : url;
  const res  = await fetch(full, { headers: { "Authorization": `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(`Twitter error (${res.status}): ${data.detail ?? JSON.stringify(data).slice(0, 200)}`);
  return data;
}

// ── Tweet text validation ──────────────────────────────────────

function validateTweet(text: string): string {
  // Twitter counts URLs as 23 chars, but we can't know how many URLs are in the text
  // Enforce a 280-char hard cap with a note if truncated
  if (text.length <= 280) return text;
  return text.slice(0, 277) + "...";
}

// ── Main ───────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${SB_SRK}` && !authHeader.startsWith("Bearer eyJ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body   = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    switch (action) {

      // ── Write ────────────────────────────────────────────────

      case "post_tweet": {
        const text = validateTweet(String(body.text ?? body.content ?? ""));
        if (!text.trim()) return json({ error: "text required" }, 400);

        const payload: Record<string, any> = { text };
        if (body.media_ids) payload.media = { media_ids: Array.isArray(body.media_ids) ? body.media_ids : [body.media_ids] };
        if (body.poll_options) payload.poll = { options: body.poll_options, duration_minutes: body.poll_duration ?? 1440 };

        const data = await tPost("/tweets", payload);
        return json({ tweet_id: data.data?.id, text: data.data?.text, url: `https://twitter.com/i/web/status/${data.data?.id}` });
      }

      case "reply_tweet": {
        const text    = validateTweet(String(body.text ?? body.content ?? ""));
        const replyTo = String(body.reply_to_id ?? body.tweet_id ?? "");
        if (!text.trim()) return json({ error: "text required" }, 400);
        if (!replyTo)     return json({ error: "reply_to_id required" }, 400);

        const data = await tPost("/tweets", { text, reply: { in_reply_to_tweet_id: replyTo } });
        return json({ tweet_id: data.data?.id, text: data.data?.text });
      }

      case "delete_tweet": {
        const tweetId = String(body.tweet_id ?? body.id ?? "");
        if (!tweetId) return json({ error: "tweet_id required" }, 400);
        const data = await tDelete(`/tweets/${tweetId}`);
        return json({ deleted: data.data?.deleted ?? true, tweet_id: tweetId });
      }

      case "like_tweet": {
        // Requires: get_me first to get userId
        const tweetId = String(body.tweet_id ?? body.id ?? "");
        if (!tweetId) return json({ error: "tweet_id required" }, 400);

        const me   = await tGet("/users/me");
        const uid  = me.data?.id;
        const data = await tPost(`/users/${uid}/likes`, { tweet_id: tweetId });
        return json({ liked: data.data?.liked ?? true, tweet_id: tweetId });
      }

      case "retweet": {
        const tweetId = String(body.tweet_id ?? body.id ?? "");
        if (!tweetId) return json({ error: "tweet_id required" }, 400);

        const me   = await tGet("/users/me");
        const uid  = me.data?.id;
        const data = await tPost(`/users/${uid}/retweets`, { tweet_id: tweetId });
        return json({ retweeted: data.data?.retweeted ?? true, tweet_id: tweetId });
      }

      // ── Read ─────────────────────────────────────────────────

      case "get_me": {
        const data = await tGet("/users/me", {
          "user.fields": "name,username,description,public_metrics,profile_image_url,url",
        });
        const u = data.data;
        return json({
          id:        u?.id,
          name:      u?.name,
          username:  u?.username,
          bio:       u?.description,
          followers: u?.public_metrics?.followers_count,
          following: u?.public_metrics?.following_count,
          tweets:    u?.public_metrics?.tweet_count,
          avatar:    u?.profile_image_url,
        });
      }

      case "get_tweet": {
        const tweetId = String(body.tweet_id ?? body.id ?? "");
        if (!tweetId) return json({ error: "tweet_id required" }, 400);

        const data = await tGet(`/tweets/${tweetId}`, {
          "tweet.fields": "created_at,public_metrics,author_id",
          expansions:     "author_id",
          "user.fields":  "name,username",
        });
        const t = data.data;
        return json({
          id:         t?.id,
          text:       t?.text,
          created_at: t?.created_at,
          likes:      t?.public_metrics?.like_count,
          retweets:   t?.public_metrics?.retweet_count,
          replies:    t?.public_metrics?.reply_count,
          url:        `https://twitter.com/i/web/status/${t?.id}`,
        });
      }

      case "get_timeline": {
        const userId  = body.user_id ? String(body.user_id) : null;
        const limit   = Math.min(Number(body.limit ?? 10), 100);

        let uid = userId;
        if (!uid) {
          const me = await tGet("/users/me");
          uid = me.data?.id;
        }

        const data = await tGet(`/users/${uid}/tweets`, {
          max_results:    String(limit),
          "tweet.fields": "created_at,public_metrics",
          exclude:        "retweets,replies",
        });

        return json({
          tweets: (data.data ?? []).map((t: any) => ({
            id:         t.id,
            text:       t.text,
            created_at: t.created_at,
            likes:      t.public_metrics?.like_count,
            retweets:   t.public_metrics?.retweet_count,
            url:        `https://twitter.com/i/web/status/${t.id}`,
          })),
        });
      }

      case "search_tweets": {
        const query = String(body.query ?? "");
        if (!query) return json({ error: "query required" }, 400);
        const limit = Math.min(Number(body.limit ?? 10), 100);

        const data = await tBearer("/tweets/search/recent", {
          query:          `${query} -is:retweet`,
          max_results:    String(Math.max(10, limit)),
          "tweet.fields": "created_at,public_metrics,author_id",
          expansions:     "author_id",
          "user.fields":  "name,username",
        });

        const users: Record<string, any> = {};
        (data.includes?.users ?? []).forEach((u: any) => { users[u.id] = u; });

        return json({
          tweets: (data.data ?? []).slice(0, limit).map((t: any) => ({
            id:         t.id,
            text:       t.text,
            author:     users[t.author_id]?.username,
            created_at: t.created_at,
            likes:      t.public_metrics?.like_count,
            retweets:   t.public_metrics?.retweet_count,
            url:        `https://twitter.com/i/web/status/${t.id}`,
          })),
          query,
        });
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: post_tweet | reply_tweet | delete_tweet | like_tweet | retweet | get_me | get_tweet | get_timeline | search_tweets`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-twitter-agent]", message);
    return json({ error: message }, message.includes("not configured") ? 503 : 500);
  }
});
