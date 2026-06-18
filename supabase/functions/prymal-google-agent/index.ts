// prymal-google-agent — Google Business Profile management
//
// Monitors reviews, drafts AI responses, manages GBP posts — all through
// the PrymalAI approval workflow. Owner approves before anything goes live.
//
// Required secrets (Supabase Dashboard → Edge Functions → Secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   ANTHROPIC_API_KEY
//   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET
//
// Per-client integration (provider='google_business' in prymal_client_integrations):
//   config: { access_token, refresh_token, expires_at, location_name }
//   location_name format: "accounts/{accountId}/locations/{locationId}"
//
// Routes:
//   POST /scan     — scan for unresponded reviews, draft + queue responses
//   POST /post     — draft a GBP post, queue for approval
//   POST /execute  — called by prymal-approval-flow after owner approves
//   GET  /status   — integration status for a client

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL       = Deno.env.get("SUPABASE_URL")!;
const SB_KEY       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLAUDE       = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const G_CLIENT_ID  = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "";
const G_CLIENT_SEC = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "";

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const GBP_BASE = "https://mybusiness.googleapis.com/v4";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Google OAuth token refresh (google_business provider) ──────────────────
async function refreshGBPToken(clientId: string): Promise<{ token: string; locationName: string } | null> {
  const { data } = await sb
    .from("prymal_client_integrations")
    .select("config, connected")
    .eq("client_id", clientId)
    .eq("provider", "google_business")
    .single();
  if (!data?.config?.refresh_token) return null;
  if (data.connected === false) return null;

  const cfg = data.config;
  let token: string = cfg.access_token;

  if (!cfg.expires_at || cfg.expires_at < Date.now() / 1000 + 300) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     G_CLIENT_ID  || cfg.client_id  || "",
        client_secret: G_CLIENT_SEC || cfg.client_secret || "",
        refresh_token: cfg.refresh_token,
        grant_type:    "refresh_token",
      }),
    });
    const d = await res.json();
    if (!d.access_token) {
      await sb.from("prymal_client_integrations")
        .update({ connected: false, error_at: new Date().toISOString(), error_msg: d.error_description ?? "token refresh failed" })
        .eq("client_id", clientId).eq("provider", "google_business");
      return null;
    }
    token = d.access_token;
    const newCfg = { ...cfg, access_token: token, expires_at: Math.floor(Date.now() / 1000) + (d.expires_in ?? 3600) };
    await sb.from("prymal_client_integrations")
      .update({ config: newCfg, error_at: null, error_msg: null })
      .eq("client_id", clientId).eq("provider", "google_business");
  }

  if (!cfg.location_name) return null;
  return { token, locationName: cfg.location_name };
}

// ── GBP API: list reviews ──────────────────────────────────────────────────
async function listReviews(token: string, locationName: string): Promise<any[]> {
  const res = await fetch(
    `${GBP_BASE}/${locationName}/reviews?pageSize=50&orderBy=updateTime%20desc`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12000) }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GBP reviews ${res.status}: ${err}`);
  }
  const d = await res.json();
  return d.reviews ?? [];
}

// ── GBP API: reply to a review ─────────────────────────────────────────────
// reviewName is the full resource path: "accounts/.../locations/.../reviews/..."
async function replyToReview(token: string, reviewName: string, comment: string): Promise<void> {
  const res = await fetch(
    `${GBP_BASE}/${reviewName}/reply`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
      signal: AbortSignal.timeout(12000),
    }
  );
  if (!res.ok) throw new Error(`GBP reply ${res.status}: ${await res.text()}`);
}

// ── GBP API: create a local post ───────────────────────────────────────────
async function createLocalPost(
  token: string,
  locationName: string,
  summary: string,
  ctaType?: string,
  ctaUrl?: string
): Promise<string> {
  const body: Record<string, unknown> = {
    languageCode: "en",
    summary,
    topicType: "STANDARD",
  };
  if (ctaType && ctaUrl) {
    body.callToAction = { actionType: ctaType, url: ctaUrl };
  }
  const res = await fetch(
    `${GBP_BASE}/${locationName}/localPosts`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    }
  );
  if (!res.ok) throw new Error(`GBP post ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.name ?? "";
}

// ── Claude: draft a review response ───────────────────────────────────────
const STAR_MAP: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const STAR_EMOJI: Record<string, string> = { ONE: "⭐", TWO: "⭐⭐", THREE: "⭐⭐⭐", FOUR: "⭐⭐⭐⭐", FIVE: "⭐⭐⭐⭐⭐" };

async function draftReviewResponse(
  review: { reviewer: string; starRating: string; comment: string },
  client: { business_name: string; tone_of_voice: string; never_say: string; knowledge_base: string }
): Promise<string> {
  const stars = STAR_MAP[review.starRating] ?? 3;
  const isNeg = stars <= 2;
  const isMid = stars === 3;

  const system = `You write Google Business Profile review responses for ${client.business_name}.
Tone: ${client.tone_of_voice ?? "professional and warm"}.
${client.never_say ? `Never say: ${client.never_say}.` : ""}
Business context: ${(client.knowledge_base ?? "").slice(0, 800) || "a local small business"}.
Rules:
- Under 150 words.
- Never echo the reviewer's exact words back at them verbatim.
- Never use "We appreciate your feedback" or "We take this seriously."
- For negative/mixed reviews: acknowledge the specific issue, apologize sincerely, invite them to reach out directly to resolve it. Never be defensive.
- For positive reviews: be warm and specific to what they mentioned, invite them back.
- Sign off naturally — don't end with your name or "Sincerely."`;

  const sentiment = isNeg ? "negative" : isMid ? "mixed" : "positive";
  const user = `Write a ${sentiment} review response.
Reviewer: ${review.reviewer || "a customer"}
Star rating: ${stars}/5
Review: "${review.comment || "(no comment — just a star rating)"}"`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": CLAUDE, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.content?.[0]?.text?.trim() ?? "";
}

// ── Claude: draft a GBP post ───────────────────────────────────────────────
async function draftGBPPost(
  brief: string,
  client: { business_name: string; tone_of_voice: string; never_say: string; knowledge_base: string }
): Promise<string> {
  const system = `You write Google Business Profile posts for ${client.business_name}.
Tone: ${client.tone_of_voice ?? "professional"}.
${client.never_say ? `Never say: ${client.never_say}.` : ""}
Business context: ${(client.knowledge_base ?? "").slice(0, 800) || "a local small business"}.
Rules:
- 100–1500 characters.
- No hashtags (Google doesn't render them).
- No markdown formatting.
- One crisp paragraph. End with a natural call to action if appropriate.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": CLAUDE, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system,
      messages: [{ role: "user", content: `Write a GBP post for ${client.business_name}.\n\nBrief: ${brief}` }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.content?.[0]?.text?.trim() ?? "";
}

// ── Queue helper — sends to prymal-approval-flow ───────────────────────────
async function queueForApproval(payload: {
  client_id: string;
  action_type: string;
  action_summary: string;
  action_payload: Record<string, unknown>;
  draft_content: string;
}): Promise<string> {
  const res = await fetch(`${SB_URL}/functions/v1/prymal-approval-flow`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SB_KEY}` },
    body: JSON.stringify({ ...payload, agent: "google" }),
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

    const { data: integration } = await sb
      .from("prymal_client_integrations")
      .select("connected, connected_at, error_msg, config")
      .eq("client_id", clientId)
      .eq("provider", "google_business")
      .single();

    if (!integration) return json({ connected: false, provider: "google_business" });

    // Count pending reviews
    const { count: pendingCount } = await sb
      .from("prymal_gmb_reviews")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("response_status", "pending");

    return json({
      connected:         integration.connected,
      connected_at:      integration.connected_at,
      has_location_name: !!integration.config?.location_name,
      error:             integration.error_msg ?? null,
      reviews_pending_response: pendingCount ?? 0,
    });
  }

  const body = await req.json().catch(() => ({})) as Record<string, any>;

  // ── POST /scan ───────────────────────────────────────────────────────────
  // Scan GBP for unresponded reviews, draft responses, queue for approval.
  if (route === "scan") {
    const { client_id } = body;
    if (!client_id) return json({ error: "client_id required" }, 400);

    const gbp = await refreshGBPToken(client_id);
    if (!gbp) return json({ error: "Google Business Profile not connected for this client", hint: "Set up the google_business integration with a valid refresh_token and location_name" }, 400);

    const { data: client } = await sb
      .from("prymal_clients")
      .select("business_name, owner_name, tone_of_voice, never_say, knowledge_base")
      .eq("id", client_id)
      .single();
    if (!client) return json({ error: "Client not found" }, 404);

    const reviews = await listReviews(gbp.token, gbp.locationName);
    const unresponded = reviews.filter((r: any) => !r.reviewReply);

    if (unresponded.length === 0) {
      return json({ ok: true, queued: 0, message: "All reviews have responses — nothing to do." });
    }

    // Filter out reviews already tracked in our DB
    const reviewIds = unresponded.map((r: any) => r.reviewId as string);
    const { data: alreadyTracked } = await sb
      .from("prymal_gmb_reviews")
      .select("google_review_id")
      .eq("client_id", client_id)
      .in("google_review_id", reviewIds);
    const trackedSet = new Set((alreadyTracked ?? []).map((r: any) => r.google_review_id as string));
    const newReviews = unresponded.filter((r: any) => !trackedSet.has(r.reviewId as string));

    if (newReviews.length === 0) {
      return json({ ok: true, queued: 0, message: "All unresponded reviews are already queued for approval." });
    }

    const queued: string[] = [];
    const errors: Array<{ review_id: string; error: string }> = [];

    for (const review of newReviews.slice(0, 10)) {
      try {
        const draft = await draftReviewResponse(
          {
            reviewer:   review.reviewer?.displayName ?? "Anonymous",
            starRating: review.starRating,
            comment:    review.comment ?? "",
          },
          client
        );

        // Track review before queuing so we have the row to update
        const { data: reviewRow } = await sb
          .from("prymal_gmb_reviews")
          .insert({
            client_id,
            google_review_id: review.reviewId,
            review_name:      review.name,
            reviewer_name:    review.reviewer?.displayName ?? "Anonymous",
            rating:           STAR_MAP[review.starRating as string] ?? 0,
            comment:          review.comment ?? "",
            review_time:      review.createTime,
            response_status:  "drafted",
          })
          .select()
          .single();

        const starsEmoji  = STAR_EMOJI[review.starRating as string] ?? "?";
        const itemId = await queueForApproval({
          client_id,
          action_type:    "reply_review",
          action_summary: `Reply to ${starsEmoji} review from ${review.reviewer?.displayName ?? "Anonymous"}`,
          action_payload: {
            review_name:      review.name,
            review_id:        review.reviewId,
            reviewer:         review.reviewer?.displayName ?? "Anonymous",
            rating:           review.starRating,
            original_comment: review.comment ?? "",
          },
          draft_content: draft,
        });

        if (reviewRow) {
          await sb.from("prymal_gmb_reviews").update({ approval_id: itemId }).eq("id", reviewRow.id);
        }
        queued.push(review.reviewId as string);
      } catch (err: any) {
        errors.push({ review_id: review.reviewId as string, error: err.message });
      }
    }

    return json({
      ok: true,
      total_unresponded: unresponded.length,
      new_reviews_found: newReviews.length,
      queued: queued.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  }

  // ── POST /post ───────────────────────────────────────────────────────────
  // Draft a GBP local post, queue for approval.
  if (route === "post") {
    const { client_id, brief, cta_type, cta_url } = body;
    if (!client_id) return json({ error: "client_id required" }, 400);
    if (!brief)     return json({ error: "brief required (describe what the post should be about)" }, 400);

    const gbp = await refreshGBPToken(client_id);
    if (!gbp) return json({ error: "Google Business Profile not connected" }, 400);

    const { data: client } = await sb
      .from("prymal_clients")
      .select("business_name, tone_of_voice, never_say, knowledge_base")
      .eq("id", client_id)
      .single();
    if (!client) return json({ error: "Client not found" }, 404);

    const draft = await draftGBPPost(brief, client);

    const itemId = await queueForApproval({
      client_id,
      action_type:    "post_gbp_update",
      action_summary: `GBP post: "${draft.slice(0, 80)}${draft.length > 80 ? "…" : ""}"`,
      action_payload: {
        location_name: gbp.locationName,
        cta_type:      cta_type ?? null,
        cta_url:       cta_url ?? null,
      },
      draft_content: draft,
    });

    return json({ ok: true, item_id: itemId, preview: draft.slice(0, 200) });
  }

  // ── POST /execute ────────────────────────────────────────────────────────
  // Called by prymal-approval-flow when owner approves.
  // Handles action_type: reply_review | post_gbp_update
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

    // owner_edit wins if present (EDIT flow)
    const content = (item.owner_edit ?? item.draft_content ?? "").trim();
    if (!content) return json({ error: "No content to publish" }, 400);

    const gbp = await refreshGBPToken(client_id);
    if (!gbp) return json({ error: "Google Business Profile not connected" }, 400);

    if (item.action_type === "reply_review") {
      const reviewName = payload?.review_name as string;
      if (!reviewName) return json({ error: "payload.review_name is required for reply_review" }, 400);

      await replyToReview(gbp.token, reviewName, content);
      await sb
        .from("prymal_gmb_reviews")
        .update({ response_status: "published", published_at: new Date().toISOString() })
        .eq("approval_id", item_id);

      return json({ ok: true, action: "replied_to_review", review_name: reviewName });
    }

    if (item.action_type === "post_gbp_update") {
      const locationName = (payload?.location_name as string) || gbp.locationName;
      const postName = await createLocalPost(
        gbp.token,
        locationName,
        content,
        payload?.cta_type as string | undefined,
        payload?.cta_url  as string | undefined
      );
      return json({ ok: true, action: "posted_gbp_update", post_name: postName });
    }

    return json({ error: `Unknown action_type: ${item.action_type}` }, 400);
  }

  return json({ error: "Unknown route. Valid routes: /scan, /post, /execute, /status" }, 404);
});
