// mavis-avatar-publish
// The one canonical "script -> trained HeyGen avatar video -> post
// everywhere" entry point. Used by mavis-social-publisher's Path C and by
// MAVIS chat/Telegram (avatar_social_post action) so both share the same
// avatar-resolution and publish logic instead of duplicating it.
//
// POST {
//   userId?, action: "generate_and_post" | "post_existing",
//   script?, video_url?, avatar_id?, voice_id?,
//   platforms: ("tiktok"|"youtube"|"facebook"|"linkedin"|"instagram"|"twitter"|"threads")[],
//   caption?,   // generic post text for facebook/linkedin/instagram/twitter/threads
//   tiktok_caption?, youtube_title?, youtube_description?, privacy_status?,
//   queue_id?,   // optional -- if set, progress is written into mavis_social_queue
// }
//
// tiktok/youtube go through their own dedicated, more capable posting
// functions (mavis-nora-tiktok, mavis-youtube-publish). Every other
// platform routes through mavis-blotato, which already accepts a generic
// video_url per platform -- previously only ever used for images/text.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { isServiceRoleCaller, resolveAuthedUid } from "../_shared/auth.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const NATIVE_PLATFORMS  = new Set(["tiktok", "youtube"]);
const BLOTATO_PLATFORMS = new Set(["facebook", "linkedin", "instagram", "twitter", "threads"]);
const ALL_PLATFORMS     = new Set([...NATIVE_PLATFORMS, ...BLOTATO_PLATFORMS]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function callFunction(name: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${SB_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SB_SRK}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(280_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: (data as Record<string, unknown>).error ?? `${name} returned ${res.status}` };
  return data as Record<string, unknown>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const adminSb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });

    const trustedInternalUid = isServiceRoleCaller(req)
      ? String(body.userId ?? body.user_id ?? "")
      : "";
    const userId = trustedInternalUid || await resolveAuthedUid(req, adminSb);
    if (!userId) return json({ error: "Unauthorized" }, 401);

    const action = String(body.action ?? "");
    if (action !== "generate_and_post" && action !== "post_existing") {
      return json({ error: 'action must be "generate_and_post" or "post_existing"' }, 400);
    }

    // Accepts either a real array (direct API callers) or a comma-separated
    // string (the LLM tool-calling schemas only support flat string params,
    // not arrays -- toolDispatch.ts/mavis-agent's tool defs describe this
    // field as "tiktok,youtube" for exactly that reason).
    const rawPlatforms = body.platforms;
    const requestedPlatforms = Array.isArray(rawPlatforms)
      ? (rawPlatforms as unknown[]).map(String)
      : typeof rawPlatforms === "string"
      ? rawPlatforms.split(",").map((p) => p.trim()).filter(Boolean)
      : [];
    const platforms = requestedPlatforms.filter((p) => ALL_PLATFORMS.has(p));
    const invalidPlatforms = requestedPlatforms.filter((p) => !ALL_PLATFORMS.has(p));
    if (!platforms.length) {
      return json({ error: `platforms required — one or more of: ${[...ALL_PLATFORMS].join(", ")}` }, 400);
    }

    const queueId = body.queue_id ? String(body.queue_id) : null;

    // ── Resolve video ──────────────────────────────────────────────────────
    let videoUrl: string | undefined;
    let avatarIdUsed: string | undefined;
    let voiceIdUsed: string | undefined;

    if (action === "post_existing") {
      videoUrl = body.video_url ? String(body.video_url) : undefined;
      if (!videoUrl) return json({ error: "video_url required for post_existing" }, 400);
    } else {
      const script = body.script ? String(body.script) : "";
      if (!script.trim()) return json({ error: "script required for generate_and_post" }, 400);

      // Resolution order, never a hardcoded fallback:
      //   1. Explicit avatar_id/voice_id
      //   2. avatar_name matched against the operator's saved roster
      //      (profiles.saved_heygen_avatars -- any of their avatars, not
      //      just "the" default)
      //   3. The operator's default_heygen_avatar_id/voice_id
      //   4. Clear error asking them to configure one
      let avatarId = body.avatar_id ? String(body.avatar_id) : "";
      let voiceId  = body.voice_id  ? String(body.voice_id)  : "";
      const avatarName = body.avatar_name ? String(body.avatar_name).trim().toLowerCase() : "";

      if (!avatarId || !voiceId) {
        const { data: profile } = await adminSb
          .from("profiles")
          .select("default_heygen_avatar_id, default_heygen_voice_id, saved_heygen_avatars")
          .eq("id", userId)
          .single();
        const p = profile as Record<string, unknown> | null;

        if (avatarName && Array.isArray(p?.saved_heygen_avatars)) {
          const match = (p!.saved_heygen_avatars as Array<Record<string, unknown>>)
            .find((a) => String(a.label ?? "").trim().toLowerCase() === avatarName);
          if (match) {
            avatarId = avatarId || String(match.avatar_id ?? "");
            voiceId  = voiceId  || String(match.voice_id ?? "");
          }
        }
        avatarId = avatarId || (p?.default_heygen_avatar_id as string) || "";
        voiceId  = voiceId  || (p?.default_heygen_voice_id as string) || "";
      }
      if (!avatarId || !voiceId) {
        return json({
          error: avatarName
            ? `No saved avatar named "${body.avatar_name}" -- save it in Avatar Studio first, or pass avatar_id/voice_id directly`
            : "No HeyGen avatar configured -- set one in Avatar Studio or pass avatar_id/voice_id",
        }, 400);
      }
      avatarIdUsed = avatarId;
      voiceIdUsed = voiceId;

      const genRes = await callFunction("mavis-heygen-agent", {
        userId, action: "generate_video",
        avatar_id: avatarId, voice_id: voiceId, text: script,
        // Same ~180s budget the old inline Path C used -- no new timeout risk.
        max_attempts: 18, poll_interval_ms: 10_000,
      });
      if (genRes.error) return json({ error: genRes.error }, 502);
      if (!genRes.completed) {
        return json({ status: "processing", video_id: genRes.video_id, note: "Still generating -- call again with action:'post_existing' and the video_url once ready, or check get_video_status." });
      }
      videoUrl = genRes.video_url as string | undefined;
      if (!videoUrl) return json({ error: "HeyGen reported complete but returned no video_url" }, 502);

      if (queueId) {
        await adminSb.from("mavis_social_queue")
          .update({
            heygen_video_id: genRes.video_id,
            heygen_avatar_id: avatarIdUsed,
            heygen_voice_id: voiceIdUsed,
            video_url: videoUrl,
            video_status: "done",
          })
          .eq("id", queueId);
      }
    }

    // ── Publish to each requested platform in parallel ────────────────────
    const results: Record<string, unknown> = {};
    const blotatoPlatforms = platforms.filter((p) => BLOTATO_PLATFORMS.has(p));
    // Generic caption for the Blotato-routed platforms -- falls back to
    // whatever caption-shaped text was already supplied for the native
    // platforms rather than requiring it be repeated.
    const genericCaption = body.caption ? String(body.caption)
      : body.tiktok_caption ? String(body.tiktok_caption)
      : body.youtube_description ? String(body.youtube_description)
      : "";

    await Promise.all([
      platforms.includes("tiktok") ? (async () => {
        results.tiktok = await callFunction("mavis-nora-tiktok", {
          user_id: userId,
          content: body.tiktok_caption ? String(body.tiktok_caption) : undefined,
          video_url: videoUrl,
        });
      })() : Promise.resolve(),

      platforms.includes("youtube") ? (async () => {
        results.youtube = await callFunction("mavis-youtube-publish", {
          userId,
          video_url: videoUrl,
          title: body.youtube_title ? String(body.youtube_title) : "Untitled",
          description: body.youtube_description ? String(body.youtube_description) : "",
          privacy_status: body.privacy_status ? String(body.privacy_status) : "private",
        });
      })() : Promise.resolve(),

      blotatoPlatforms.length ? (async () => {
        if (!genericCaption.trim()) {
          const err = { error: "caption required to post to " + blotatoPlatforms.join(", ") };
          for (const p of blotatoPlatforms) results[p] = err;
          return;
        }
        const blRes = await callFunction("mavis-blotato", {
          platforms: blotatoPlatforms,
          content: genericCaption,
          video_url: videoUrl,
        });
        const perPlatform = Array.isArray(blRes.results) ? blRes.results as Array<Record<string, unknown>> : null;
        for (const p of blotatoPlatforms) {
          results[p] = perPlatform?.find((r) => r.platform === p) ?? blRes;
        }
      })() : Promise.resolve(),
    ]);

    if (queueId) {
      const youtubeResult = results.youtube as Record<string, unknown> | undefined;
      await adminSb.from("mavis_social_queue")
        .update({
          youtube_video_id: youtubeResult?.video_id ?? null,
          youtube_url: youtubeResult?.url ?? null,
          youtube_status: youtubeResult?.success ? "done" : (youtubeResult?.error ? "failed" : "skipped"),
          publish_results: results,
          status: "published",
          published_at: new Date().toISOString(),
        })
        .eq("id", queueId);
    }

    return json({
      video_url: videoUrl,
      results,
      ...(invalidPlatforms.length ? { invalid_platforms: invalidPlatforms } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("mavis-avatar-publish error:", msg);
    return json({ error: msg }, 500);
  }
});
