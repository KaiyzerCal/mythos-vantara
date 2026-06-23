// MAVIS HeyGen Agent — AI avatar video generation with polling.
// Mirrors n8n: Config → POST /v2/video/generate → Wait(10s) loop →
//   GET /v1/video_status.get until status=completed → return video_url.
//
// Actions: generate_video | get_video_status | list_avatars | list_voices
//
// generate_video polls up to max_attempts (default 12 × 10 s = 120 s).
// If still processing after that, returns { video_id, status: "processing" }
// — caller can follow up with get_video_status.
//
// Requires: HEYGEN_API_KEY env var (X-Api-Key header auth).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SB_URL     = Deno.env.get("SUPABASE_URL")!;
const SB_SRK     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HEYGEN_KEY = Deno.env.get("HEYGEN_API_KEY")!;

const HG_V1 = "https://api.heygen.com/v1";
const HG_V2 = "https://api.heygen.com/v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function hg(method: string, base: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "X-Api-Key": HEYGEN_KEY, "Content-Type": "application/json", "Accept": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { userId, action, ...p } = body as Record<string, unknown>;

    if (!userId) throw new Error("userId required");
    if (!action)  throw new Error("action required");

    const adminSb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });
    let result: unknown;

    switch (action as string) {
      // ── GENERATE VIDEO ─────────────────────────────────────────────────────
      // Submits the job then polls until status=completed or max_attempts reached.
      case "generate_video": {
        const {
          avatar_id,
          voice_id,
          text,
          avatar_style    = "normal",   // "normal" | "circle" | "closeUp"
          width           = 1080,
          height          = 1920,       // portrait (9:16) by default
          caption         = true,
          speed           = 1,
          background_color,
          max_attempts    = 12,         // 12 × 10 s = 120 s max wait
          poll_interval_ms = 10_000,
        } = p as Record<string, unknown>;

        if (!avatar_id) throw new Error("avatar_id required — use list_avatars to browse available avatars");
        if (!voice_id)  throw new Error("voice_id required — use list_voices to browse available voices");
        if (!text)      throw new Error("text (the script to speak) required");

        const videoInput: Record<string, unknown> = {
          character: { type: "avatar", avatar_id, avatar_style },
          voice:     { type: "text", input_text: text, voice_id, speed },
        };
        if (background_color) videoInput.background = { type: "color", value: background_color };

        const createR = await hg("POST", HG_V2, "/video/generate", {
          video_inputs: [videoInput],
          caption,
          dimension: { width, height },
        });
        if (!createR.ok) throw new Error(`HeyGen generate error ${createR.status}: ${JSON.stringify(createR.data)}`);

        const videoId = ((createR.data as Record<string, unknown>)?.data as Record<string, unknown>)?.video_id as string;
        if (!videoId) throw new Error(`HeyGen did not return a video_id. Response: ${JSON.stringify(createR.data)}`);

        // Poll until completed, failed, or max_attempts exhausted
        let attempts = 0;
        let statusData: Record<string, unknown> = {};
        while (attempts < (max_attempts as number)) {
          await sleep(poll_interval_ms as number);
          const statusR = await hg("GET", HG_V1, `/video_status.get?video_id=${encodeURIComponent(videoId)}`);
          if (!statusR.ok) throw new Error(`HeyGen status error ${statusR.status}: ${JSON.stringify(statusR.data)}`);
          statusData = (statusR.data as Record<string, unknown>)?.data as Record<string, unknown> ?? {};
          if (statusData.status === "completed") break;
          if (statusData.status === "failed")    throw new Error(`HeyGen generation failed: ${JSON.stringify(statusData)}`);
          attempts++;
        }

        const completed = statusData.status === "completed";
        result = {
          video_id:      videoId,
          status:        statusData.status ?? "processing",
          video_url:     statusData.video_url    ?? null,
          thumbnail_url: statusData.thumbnail_url ?? null,
          duration:      statusData.duration      ?? null,
          completed,
          attempts: attempts + (completed ? 1 : 0),
          message: completed
            ? "Video generated successfully."
            : `Video still processing after ${attempts} poll attempts. Call get_video_status with video_id="${videoId}" to check when it's ready.`,
        };
        break;
      }

      // ── GET VIDEO STATUS ───────────────────────────────────────────────────
      case "get_video_status": {
        const { video_id } = p as { video_id: string };
        if (!video_id) throw new Error("video_id required");
        const r = await hg("GET", HG_V1, `/video_status.get?video_id=${encodeURIComponent(video_id)}`);
        if (!r.ok) throw new Error(`HeyGen status error ${r.status}: ${JSON.stringify(r.data)}`);
        const d = (r.data as Record<string, unknown>)?.data as Record<string, unknown> ?? {};
        result = {
          video_id,
          status:        d.status        ?? "unknown",
          video_url:     d.video_url     ?? null,
          thumbnail_url: d.thumbnail_url ?? null,
          duration:      d.duration      ?? null,
          completed:     d.status === "completed",
        };
        break;
      }

      // ── LIST AVATARS ───────────────────────────────────────────────────────
      case "list_avatars": {
        const r = await hg("GET", HG_V2, "/avatars");
        if (!r.ok) throw new Error(`HeyGen avatars error ${r.status}: ${JSON.stringify(r.data)}`);
        const avatars = ((r.data as Record<string, unknown>)?.data as Record<string, unknown>)?.avatars ?? [];
        result = { avatars, count: (avatars as unknown[]).length };
        break;
      }

      // ── LIST VOICES ────────────────────────────────────────────────────────
      case "list_voices": {
        const r = await hg("GET", HG_V2, "/voices");
        if (!r.ok) throw new Error(`HeyGen voices error ${r.status}: ${JSON.stringify(r.data)}`);
        const voices = ((r.data as Record<string, unknown>)?.data as Record<string, unknown>)?.voices ?? [];
        result = { voices, count: (voices as unknown[]).length };
        break;
      }

      default:
        throw new Error(`Unknown HeyGen action: ${action}. Supported: generate_video, get_video_status, list_avatars, list_voices`);
    }

    await adminSb.from("mavis_memory").insert({
      user_id:    userId,
      content:    action === "generate_video"
        ? `HeyGen video generated: ${(result as Record<string, unknown>).video_url ?? "processing"} (id: ${(result as Record<string, unknown>).video_id})`
        : `HeyGen ${action}: ${JSON.stringify(result).slice(0, 200)}`,
      importance: action === "generate_video" ? 4 : 2,
      tags:       ["heygen", "video_generation", "ai_avatar", action as string],
    }).then(() => {});

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
