// mavis-higgsfield — Higgsfield AI video generation with cinematic camera controls.
// Specialties: image-to-video animation, camera motion, character consistency,
// cinematic short-form content.
//
// Actions: generate_video | get_video_status | list_models
//
// generate_video submits a job and polls until completed or max_attempts reached.
// If still processing, returns { video_id, status:"processing" } — follow up with
// get_video_status.
//
// Required env vars:
//   HIGGSFIELD_API_KEY — Higgsfield API key (higgsfield.ai)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SB_URL       = Deno.env.get("SUPABASE_URL")!;
const SB_SRK       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HF_KEY       = Deno.env.get("HIGGSFIELD_API_KEY") ?? "";
const HF_BASE      = "https://api.higgsfield.ai";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function hf(method: string, path: string, body?: unknown) {
  if (!HF_KEY) throw new Error("HIGGSFIELD_API_KEY not configured — add it in Supabase project secrets");
  const res = await fetch(`${HF_BASE}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${HF_KEY}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

// ── Camera motion presets ─────────────────────────────────────────────────────
// Higgsfield's differentiator: fine-grained camera control.
// Pass camera_motion as a string from this list or a custom description.
const CAMERA_PRESETS = [
  "static",
  "zoom_in", "zoom_out",
  "pan_left", "pan_right",
  "tilt_up", "tilt_down",
  "push_in", "pull_out",
  "orbit_left", "orbit_right",
  "crane_up", "crane_down",
  "handheld",
  "dolly_zoom",
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }

  const { userId, action, ...p } = body;
  if (!userId) return json({ error: "userId required" }, 400);
  if (!action)  return json({ error: "action required" }, 400);

  const adminSb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });
  let result: unknown;

  try {
    switch (action as string) {

      // ── GENERATE VIDEO ─────────────────────────────────────────────────────
      // image_url: animate a still image (image-to-video)
      // prompt: describe what happens in the video
      // camera_motion: one of CAMERA_PRESETS or a custom string
      case "generate_video": {
        const {
          prompt,
          image_url,
          model           = "higgsfield-1",
          duration        = 4,              // seconds; 2-8 supported
          aspect_ratio    = "9:16",         // "9:16" | "16:9" | "1:1"
          camera_motion   = "static",       // see CAMERA_PRESETS
          seed,
          max_attempts    = 24,             // 24 × 5 s = 120 s max
          poll_interval_ms = 5_000,
        } = p as Record<string, unknown>;

        if (!prompt) throw new Error("prompt required — describe what should happen in the video");

        const reqBody: Record<string, unknown> = {
          model,
          prompt,
          duration: Number(duration),
          aspect_ratio,
          camera_motion,
        };
        if (image_url) reqBody.image_url = image_url;
        if (seed !== undefined) reqBody.seed = Number(seed);

        const createR = await hf("POST", "/v1/generation/create", reqBody);
        if (!createR.ok) {
          throw new Error(`Higgsfield generate error ${createR.status}: ${JSON.stringify(createR.data)}`);
        }

        const videoId = (createR.data as Record<string, unknown>)?.id as string
          ?? (createR.data as Record<string, unknown>)?.generation_id as string;
        if (!videoId) throw new Error(`Higgsfield did not return an ID. Response: ${JSON.stringify(createR.data)}`);

        // Poll until completed or max_attempts exhausted
        let attempts = 0;
        let statusData: Record<string, unknown> = {};
        while (attempts < (max_attempts as number)) {
          await sleep(poll_interval_ms as number);
          const statusR = await hf("GET", `/v1/generation/${videoId}`);
          if (!statusR.ok) throw new Error(`Higgsfield status error ${statusR.status}: ${JSON.stringify(statusR.data)}`);
          statusData = statusR.data as Record<string, unknown> ?? {};
          const st = String(statusData.status ?? statusData.state ?? "");
          if (st === "completed" || st === "succeeded" || st === "done") break;
          if (st === "failed" || st === "error") {
            throw new Error(`Higgsfield generation failed: ${JSON.stringify(statusData)}`);
          }
          attempts++;
        }

        const finalStatus = String(statusData.status ?? statusData.state ?? "processing");
        const completed   = ["completed", "succeeded", "done"].includes(finalStatus);
        const videoUrl    = (statusData.video_url ?? statusData.output_url ?? statusData.url) as string | null;

        result = {
          video_id:      videoId,
          status:        completed ? "completed" : "processing",
          video_url:     videoUrl ?? null,
          thumbnail_url: (statusData.thumbnail_url ?? null) as string | null,
          duration,
          camera_motion,
          completed,
          attempts: attempts + (completed ? 1 : 0),
          message: completed
            ? "Higgsfield video generated successfully."
            : `Still processing after ${attempts} attempts. Call get_video_status with video_id="${videoId}" to check when ready.`,
        };
        break;
      }

      // ── GET VIDEO STATUS ───────────────────────────────────────────────────
      case "get_video_status": {
        const { video_id } = p as { video_id: string };
        if (!video_id) throw new Error("video_id required");
        const r = await hf("GET", `/v1/generation/${video_id}`);
        if (!r.ok) throw new Error(`Higgsfield status error ${r.status}: ${JSON.stringify(r.data)}`);
        const d = r.data as Record<string, unknown> ?? {};
        const st = String(d.status ?? d.state ?? "");
        const completed = ["completed", "succeeded", "done"].includes(st);
        result = {
          video_id,
          status:        st || "unknown",
          video_url:     (d.video_url ?? d.output_url ?? d.url ?? null) as string | null,
          thumbnail_url: (d.thumbnail_url ?? null) as string | null,
          completed,
        };
        break;
      }

      // ── LIST MODELS ────────────────────────────────────────────────────────
      case "list_models": {
        const r = await hf("GET", "/v1/models");
        if (!r.ok) throw new Error(`Higgsfield models error ${r.status}: ${JSON.stringify(r.data)}`);
        result = {
          models: (r.data as Record<string, unknown>)?.models ?? r.data,
          camera_presets: CAMERA_PRESETS,
        };
        break;
      }

      default:
        throw new Error(`Unknown Higgsfield action: ${action}. Supported: generate_video, get_video_status, list_models`);
    }

    // Log to memory
    await adminSb.from("mavis_memory").insert({
      user_id:    userId,
      content:    action === "generate_video"
        ? `Higgsfield video: ${(result as Record<string, unknown>).video_url ?? "processing"} (id: ${(result as Record<string, unknown>).video_id})`
        : `Higgsfield ${action}: ${JSON.stringify(result).slice(0, 200)}`,
      importance: action === "generate_video" ? 4 : 2,
      tags:       ["higgsfield", "video_generation", "cinematic", action as string],
    }).then(() => {});

    return json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});
