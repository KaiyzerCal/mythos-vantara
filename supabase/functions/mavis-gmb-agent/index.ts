// mavis-gmb-agent
// Google My Business (Google Business Profile) — reviews, locations, AI reply pipeline.
// Requires: OAuth token in mavis_user_integrations with provider='gmb'
//           Scope: https://www.googleapis.com/auth/business.manage
//           ANTHROPIC_API_KEY (for AI replies in monitor_reviews)
//
// Actions: list_accounts | list_locations | list_reviews | get_review
//          reply_to_review | monitor_reviews

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_SRK        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GMB_API       = "https://mybusiness.googleapis.com/v4";
const GMB_ACCT_API  = "https://mybusinessaccountmanagement.googleapis.com/v1";

// ── Auth ─────────────────────────────────────────────────────────────────────

async function refreshToken(config: any, sb: any, uid: string): Promise<string> {
  if (config.expires_at && config.expires_at > Date.now() / 1000 + 300) {
    return config.access_token;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     config.client_id,
      client_secret: config.client_secret,
      refresh_token: config.refresh_token,
      grant_type:    "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("GMB token refresh failed: " + JSON.stringify(data).slice(0, 200));
  const newConfig = {
    ...config,
    access_token: data.access_token,
    expires_at:   Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
  };
  await sb.from("mavis_user_integrations")
    .update({ config: newConfig })
    .eq("user_id", uid)
    .eq("provider", "gmb");
  return data.access_token;
}

async function getToken(sb: any, uid: string): Promise<string> {
  const { data } = await sb
    .from("mavis_user_integrations")
    .select("config")
    .eq("user_id", uid)
    .eq("provider", "gmb")
    .single();
  if (!data?.config) {
    throw new Error(
      "Google My Business not connected. Go to Integrations and add a GMB connection with scope: https://www.googleapis.com/auth/business.manage"
    );
  }
  return refreshToken(data.config, sb, uid);
}

// ── API request ───────────────────────────────────────────────────────────────

async function gmbReq(token: string, url: string, method = "GET", body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GMB API ${res.status}: ${err.slice(0, 300)}`);
  }
  return method === "DELETE" ? { deleted: true } : res.json();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function starLabel(star: string): string {
  const MAP: Record<string, string> = {
    ONE: "⭐", TWO: "⭐⭐", THREE: "⭐⭐⭐", FOUR: "⭐⭐⭐⭐", FIVE: "⭐⭐⭐⭐⭐",
  };
  return MAP[star] ?? star;
}

function starNum(star: string): number {
  return { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }[star] ?? 0;
}

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

    // list_accounts doesn't need a location — get token upfront for all actions
    let token: string;
    try {
      token = await getToken(adminSb, uid);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }

    switch (action) {

      case "list_accounts": {
        const data = await gmbReq(token, `${GMB_ACCT_API}/accounts`);
        return json({
          accounts: (data.accounts ?? []).map((a: any) => ({
            id:   a.name?.split("/").pop(),
            name: a.accountName ?? a.name,
            type: a.type,
          })),
        });
      }

      case "list_locations": {
        const accountId = String(body.account_id ?? "");
        if (!accountId) return json({ error: "account_id required" }, 400);
        const data = await gmbReq(token, `${GMB_API}/accounts/${accountId}/locations?pageSize=100`);
        return json({
          locations: (data.locations ?? []).map((l: any) => ({
            id:      l.name?.split("/").pop(),
            name:    l.locationName,
            address: l.address?.formattedAddress ?? "",
            phone:   l.primaryPhone ?? "",
          })),
        });
      }

      case "list_reviews": {
        const accountId  = String(body.account_id ?? "");
        const locationId = String(body.location_id ?? "");
        const pageSize   = Math.min(Number(body.page_size ?? 50), 50);
        const since      = body.since ? new Date(String(body.since)) : null;
        if (!accountId || !locationId) return json({ error: "account_id and location_id required" }, 400);

        const parent = `accounts/${accountId}/locations/${locationId}`;
        const data   = await gmbReq(token, `${GMB_API}/${parent}/reviews?pageSize=${pageSize}&orderBy=updateTime desc`);
        let reviews: any[] = data.reviews ?? [];

        if (since) {
          reviews = reviews.filter(r => new Date(r.updateTime ?? r.createTime) > since);
        }

        return json({
          reviews: reviews.map(r => ({
            id:          r.name?.split("/").pop(),
            name:        r.name,
            reviewer:    r.reviewer?.displayName ?? "Anonymous",
            star_rating: r.starRating,
            stars:       starLabel(r.starRating),
            comment:     r.comment ?? "",
            create_time: r.createTime,
            update_time: r.updateTime,
            has_reply:   !!r.reviewReply?.comment,
            reply:       r.reviewReply?.comment ?? null,
          })),
          total_review_count: data.totalReviewCount,
          average_rating:     data.averageRating,
        });
      }

      case "get_review": {
        const accountId  = String(body.account_id ?? "");
        const locationId = String(body.location_id ?? "");
        const reviewId   = String(body.review_id ?? "");
        if (!accountId || !locationId || !reviewId) return json({ error: "account_id, location_id, review_id required" }, 400);
        const r = await gmbReq(token, `${GMB_API}/accounts/${accountId}/locations/${locationId}/reviews/${reviewId}`);
        return json({
          id:          r.name?.split("/").pop(),
          name:        r.name,
          reviewer:    r.reviewer?.displayName ?? "Anonymous",
          star_rating: r.starRating,
          stars:       starLabel(r.starRating),
          comment:     r.comment ?? "",
          create_time: r.createTime,
          has_reply:   !!r.reviewReply?.comment,
          reply:       r.reviewReply?.comment ?? null,
        });
      }

      case "reply_to_review": {
        const reviewName = String(body.review_name ?? body.name ?? "");
        const comment    = String(body.comment ?? body.reply ?? "");
        if (!reviewName || !comment) return json({ error: "review_name and comment required" }, 400);
        // review_name is the full resource name: accounts/{a}/locations/{l}/reviews/{r}
        const result = await gmbReq(token, `${GMB_API}/${reviewName}/reply`, "PUT", { comment });
        return json({ review_name: reviewName, reply: result.comment, update_time: result.updateTime });
      }

      case "monitor_reviews": {
        // Full pipeline: list new reviews → AI reply → log to Sheets → post reply → watermark.
        // Mirrors Make.com: watchReviews → addRow → AI completion → createUpdateAReply.
        const accountId    = String(body.account_id ?? "");
        const locationId   = String(body.location_id ?? "");
        const spreadsheetId = body.spreadsheet_id ? String(body.spreadsheet_id) : null;
        const sheetName    = String(body.sheet_name ?? "Reviews");
        const signature    = body.reply_signature ? String(body.reply_signature) : "";
        const businessName = String(body.business_name ?? "our business");
        const stateKey     = String(body.state_key ?? "gmb_review_watch_state");
        const autoReply    = body.auto_reply !== false;
        if (!accountId || !locationId) return json({ error: "account_id and location_id required" }, 400);

        // Load last check watermark
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

        // Fetch reviews
        const parent      = `accounts/${accountId}/locations/${locationId}`;
        const reviewsData = await gmbReq(token, `${GMB_API}/${parent}/reviews?pageSize=50&orderBy=updateTime desc`);
        const allReviews: any[] = reviewsData.reviews ?? [];

        // Filter to new/updated since last check
        const newReviews = lastCheckIso
          ? allReviews.filter(r => new Date(r.updateTime ?? r.createTime) > new Date(lastCheckIso))
          : allReviews.slice(0, 10);

        const nowIso  = new Date().toISOString();
        const results: any[] = [];

        const replySystem =
          `You are a professional customer service manager responding to Google reviews on behalf of ${businessName}.\n` +
          `Write a warm, professional reply that:\n` +
          `- Addresses the reviewer by first name if available\n` +
          `- For 4-5 star reviews: express genuine gratitude and reinforce what they praised\n` +
          `- For 1-3 star reviews: apologize sincerely, acknowledge the concern, invite them to contact you offline to resolve\n` +
          `- Keep it 2-4 sentences, conversational, not robotic\n` +
          (signature ? `- Sign off with: ${signature}\n` : "") +
          `Return ONLY the reply text. No quotes, no explanation.`;

        for (const review of newReviews) {
          try {
            const reviewer   = review.reviewer?.displayName ?? "Valued Customer";
            const starRating = review.starRating ?? "UNKNOWN";
            const comment    = review.comment ?? "";
            const reviewName = review.name ?? "";

            // AI reply
            const replyText = await callClaude(
              replySystem,
              `Reviewer: ${reviewer}\nRating: ${starLabel(starRating)} (${starNum(starRating)}/5)\nReview: ${comment.slice(0, 1000)}`,
              512,
            );

            // Log to Sheets
            let sheetsLogged = false;
            if (spreadsheetId) {
              const sheetsRes = await fetch(`${SB_URL}/functions/v1/mavis-sheets-agent`, {
                method:  "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SB_SRK}` },
                body: JSON.stringify({
                  userId:         uid,
                  action:         "append_row",
                  spreadsheet_id: spreadsheetId,
                  sheet_name:     sheetName,
                  values: {
                    Date:     new Date(review.createTime ?? nowIso).toISOString().split("T")[0],
                    Reviewer: reviewer,
                    Rating:   starNum(starRating),
                    Stars:    starLabel(starRating),
                    Review:   comment.slice(0, 500),
                    AI_Reply: replyText.slice(0, 500),
                    Location: locationId,
                    Posted:   autoReply && !review.reviewReply?.comment ? "Yes" : "Draft",
                  },
                }),
                signal: AbortSignal.timeout(10000),
              });
              sheetsLogged = sheetsRes.ok;
            }

            // Post reply if auto_reply enabled and review has no existing reply
            let repliedAt: string | null = null;
            if (autoReply && !review.reviewReply?.comment && reviewName) {
              await gmbReq(token, `${GMB_API}/${reviewName}/reply`, "PUT", { comment: replyText });
              repliedAt = nowIso;
            }

            results.push({
              review_name:   reviewName,
              reviewer,
              star_rating:   starRating,
              stars:         starLabel(starRating),
              comment:       comment.slice(0, 200),
              ai_reply:      replyText,
              reply_preview: replyText.slice(0, 150),
              sheets_logged: sheetsLogged,
              replied_at:    repliedAt,
            });
          } catch (e: unknown) {
            results.push({ review_name: review.name, error: e instanceof Error ? e.message : String(e) });
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
            tags:       [stateKey, "gmb_reviews", "system_state"],
            importance: 3,
          });
        }

        return json({
          account_id:           accountId,
          location_id:          locationId,
          total_reviews:        allReviews.length,
          new_since_last_check: newReviews.length,
          processed:            results.length,
          replied:              results.filter(r => r.replied_at).length,
          sheets_logged:        results.filter(r => r.sheets_logged).length,
          average_rating:       reviewsData.averageRating,
          results,
        });
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: list_accounts | list_locations | list_reviews | get_review | reply_to_review | monitor_reviews`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-gmb-agent]", message);
    const status = message.includes("not connected") ? 503 : 500;
    return json({ error: message }, status);
  }
});
