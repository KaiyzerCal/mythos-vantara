// mavis-youtube-publish
// Uploads a video to YouTube via resumable upload, using the Google OAuth
// tokens mavis-google-oauth already stores under provider="youtube"
// (already requests the full youtube upload scope — no separate consent
// flow needed here).
//
// POST { userId?, video_url, title, description?, tags?, privacy_status?, category_id? }
//
// NOTE: this cannot be live-verified in this sandbox (no network egress to
// Google's API). The resumable-upload two-step handshake and response
// header casing should be smoke-tested against a real YouTube account
// before this is trusted in production.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { isServiceRoleCaller, resolveAuthedUid } from "../_shared/auth.ts";
import { getGoogleToken } from "../_shared/googleAuth.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const adminSb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });

    // A caller presenting the exact service-role key is trusted to name any
    // userId (internal automation posting on a specific user's behalf);
    // everyone else must prove identity via a real Supabase JWT.
    const trustedInternalUid = isServiceRoleCaller(req)
      ? String((body as Record<string, unknown>).userId ?? (body as Record<string, unknown>).user_id ?? "")
      : "";
    const userId = trustedInternalUid || await resolveAuthedUid(req, adminSb);
    if (!userId) return json({ error: "Unauthorized" }, 401);

    const {
      video_url,
      title,
      description = "",
      tags,
      privacy_status = "private",
      category_id = "22",
    } = body as Record<string, unknown>;

    if (!video_url) return json({ error: "video_url required" }, 400);
    if (!title)     return json({ error: "title required" }, 400);

    let accessToken: string;
    try {
      accessToken = await getGoogleToken(adminSb, userId, "youtube");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return json({ error: `YouTube not connected: ${msg}` }, 400);
    }

    // Step 1 — open a resumable upload session.
    const initRes = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Upload-Content-Type": "video/mp4",
        },
        body: JSON.stringify({
          snippet: {
            title: String(title).slice(0, 100),
            description: String(description ?? ""),
            tags: Array.isArray(tags) ? tags : undefined,
            categoryId: String(category_id ?? "22"),
          },
          status: {
            // First-ever automated upload path to a real channel -- default
            // to private, let callers explicitly opt into wider visibility
            // once they trust the output.
            privacyStatus: String(privacy_status ?? "private"),
            selfDeclaredMadeForKids: false,
          },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!initRes.ok) {
      const errText = await initRes.text().catch(() => "");
      return json({ error: `YouTube upload init ${initRes.status}: ${errText.slice(0, 300)}` }, 502);
    }
    const uploadUrl = initRes.headers.get("Location") ?? initRes.headers.get("location");
    if (!uploadUrl) return json({ error: "YouTube did not return a resumable upload URL" }, 502);

    // Step 2 — fetch the source bytes and PUT them in one shot. HeyGen
    // avatar clips are short-form; a single PUT to the resumable endpoint
    // is far simpler than true chunked upload, which only pays for itself
    // on multi-GB files this pipeline will never produce.
    const videoRes = await fetch(String(video_url), { signal: AbortSignal.timeout(60_000) });
    if (!videoRes.ok) return json({ error: `Could not fetch video_url: ${videoRes.status}` }, 400);
    const videoBuffer = await videoRes.arrayBuffer();

    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4" },
      body: videoBuffer,
      signal: AbortSignal.timeout(120_000),
    });
    const uploadData = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok || !(uploadData as Record<string, unknown>).id) {
      return json({ error: `YouTube upload failed ${uploadRes.status}: ${JSON.stringify(uploadData).slice(0, 300)}` }, 502);
    }
    const videoId = (uploadData as Record<string, unknown>).id as string;

    const { error: dbError } = await adminSb.from("mavis_social_posts").insert({
      user_id: userId,
      platform: "youtube",
      persona: "nora_vale",
      content: String(title),
      status: "posted",
      external_post_id: videoId,
      posted_at: new Date().toISOString(),
    });
    if (dbError) console.error("[mavis-youtube-publish] mavis_social_posts insert failed:", dbError.message);

    return json({
      success: true,
      video_id: videoId,
      url: `https://youtu.be/${videoId}`,
      privacy_status: String(privacy_status ?? "private"),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("mavis-youtube-publish error:", msg);
    return json({ error: msg }, 500);
  }
});
