// MAVIS Nora Post
// Posts tweets as the Nora Vale AI business persona using Twitter API v2 + OAuth 1.0a.
//
// Required env vars:
//   TWITTER_API_KEY             — consumer key
//   TWITTER_API_SECRET          — consumer secret
//   TWITTER_NORA_ACCESS_TOKEN   — Nora's account access token
//   TWITTER_NORA_ACCESS_SECRET  — Nora's account access token secret
//
// POST request body:
//   { userId, content, replyToTweetId? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ─────────────────────────────────────────────────────────────
// NORA VALE PERSONA
// ─────────────────────────────────────────────────────────────

const _NORA_PERSONA =
  "Tech-forward business strategist. Founder mindset. Cuts through noise. " +
  "Talks about revenue systems, AI automation, and building leverage. " +
  "Never corporate-speak. Direct and real.";

// ─────────────────────────────────────────────────────────────
// OAUTH 1.0a HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Percent-encode a string per RFC 5849 / OAuth 1.0a.
 * encodeURIComponent leaves  ! ' ( ) *  unencoded — OAuth requires them encoded.
 */
function oauthEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => {
    return "%" + c.charCodeAt(0).toString(16).toUpperCase();
  });
}

/**
 * HMAC-SHA1 using Deno WebCrypto.
 * Returns the result as a base64 string.
 */
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
  // Convert ArrayBuffer → base64
  const bytes = new Uint8Array(signature);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Builds the full OAuth Authorization header for a request.
 *
 * For Twitter API v2 POST /2/tweets the request body is JSON, so only
 * the OAuth params go into the signature base string — not the body.
 */
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

  // Signature base string: only OAuth params (no JSON body for v2 JSON endpoints)
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

  // Build the Authorization header — params sorted alphabetically
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

// ─────────────────────────────────────────────────────────────
// CONTENT HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Truncate text to at most maxLen characters, breaking at a word boundary
 * and appending an ellipsis character.
 */
function truncateAtWord(text: string, maxLen = 280): string {
  if (text.length <= maxLen) return text;
  // Reserve 1 char for the ellipsis
  const cutoff = text.lastIndexOf(" ", maxLen - 1);
  const end = cutoff > 0 ? cutoff : maxLen - 1;
  return text.slice(0, end) + "…";
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

const TWITTER_API_KEY = Deno.env.get("TWITTER_API_KEY");
const TWITTER_API_SECRET = Deno.env.get("TWITTER_API_SECRET");
const TWITTER_NORA_ACCESS_TOKEN = Deno.env.get("TWITTER_NORA_ACCESS_TOKEN");
const TWITTER_NORA_ACCESS_SECRET = Deno.env.get("TWITTER_NORA_ACCESS_SECRET");

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // Guard: all credentials must be present
  if (
    !TWITTER_API_KEY ||
    !TWITTER_API_SECRET ||
    !TWITTER_NORA_ACCESS_TOKEN ||
    !TWITTER_NORA_ACCESS_SECRET
  ) {
    return new Response(
      JSON.stringify({
        success: false,
        error:
          "Twitter credentials not configured — set TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_NORA_ACCESS_TOKEN, TWITTER_NORA_ACCESS_SECRET",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  let body: {
    userId: string;
    content: string;
    replyToTweetId?: string;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const { userId, content, replyToTweetId } = body;

  if (!userId || !content) {
    return new Response(
      JSON.stringify({ success: false, error: "userId and content are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Truncate to 280 chars at word boundary
  const tweetText = truncateAtWord(content, 280);

  const TWEETS_URL = "https://api.twitter.com/2/tweets";

  try {
    // Build OAuth header
    const authHeader = await buildOAuthHeader(
      "POST",
      TWEETS_URL,
      TWITTER_API_KEY,
      TWITTER_API_SECRET,
      TWITTER_NORA_ACCESS_TOKEN,
      TWITTER_NORA_ACCESS_SECRET,
    );

    // Build tweet payload
    const tweetPayload: Record<string, unknown> = { text: tweetText };
    if (replyToTweetId) {
      tweetPayload.reply = { in_reply_to_tweet_id: replyToTweetId };
    }

    // Post tweet
    const twitterRes = await fetch(TWEETS_URL, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(tweetPayload),
    });

    if (!twitterRes.ok) {
      const errText = await twitterRes.text();
      throw new Error(`Twitter API error (${twitterRes.status}): ${errText}`);
    }

    const twitterData = await twitterRes.json() as { data: { id: string; text: string } };
    const tweetId = twitterData.data.id;
    const tweetUrl = `https://twitter.com/NoraVale/status/${tweetId}`;

    // Log to mavis_social_posts
    const { error: dbError } = await supabase.from("mavis_social_posts").insert({
      user_id: userId,
      platform: "twitter",
      persona: "nora_vale",
      content: tweetText,
      tweet_id: tweetId,
      status: "posted",
      posted_at: new Date().toISOString(),
    });

    if (dbError) {
      // Log but don't fail the response — tweet already posted
      console.error("[NoraPost] DB insert error:", dbError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        tweetId,
        tweetUrl,
        content: tweetText,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[NoraPost]", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
