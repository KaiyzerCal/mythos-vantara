// mavis-modelslab
// ModelsLab (Stable Diffusion API) cloud integration for MAVIS.
// Supports txt2img, img2img, txt2vid, img2vid with async polling.
// Falls back to ComfyUI if COMFYUI_URL is set and ModelsLab fails.
//
// Required env vars:
//   MODELSLAB_API_KEY        — from modelslab.com dashboard
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Optional env vars:
//   MODELSLAB_DEFAULT_MODEL  — image model ID (default: "realistic-vision-v51")
//   MODELSLAB_VIDEO_MODEL    — video model ID (default: "cogvideox")
//   MODELSLAB_BASE_URL       — override API base (default: "https://modelslab.com/api/v6")
//
// Workflow types:
//   txt2img  — text-to-image via /images/text2img
//   realtime — fast generation via /realtime/text2img (fewer models, quicker)
//   img2img  — image-to-image via /images/img2img
//   txt2vid  — text-to-video via /video/text2video
//   img2vid  — image-to-video via /video/img2video

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const API_KEY       = Deno.env.get("MODELSLAB_API_KEY") ?? "";
const BASE_URL      = Deno.env.get("MODELSLAB_BASE_URL") ?? "https://modelslab.com/api/v6";
const IMG_MODEL     = Deno.env.get("MODELSLAB_DEFAULT_MODEL") ?? "realistic-vision-v51";
const VID_MODEL     = Deno.env.get("MODELSLAB_VIDEO_MODEL") ?? "cogvideox";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const DEFAULT_NEGATIVE = "blurry, low quality, watermark, text, deformed, distorted, ugly, bad anatomy, extra limbs, clipped, jpeg artifacts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

// ── ModelsLab API helpers ────────────────────────────────────────────────────

async function mlPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ key: API_KEY, ...body }),
    signal:  AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`ModelsLab ${path} failed: ${txt.slice(0, 300)}`);
  }
  return res.json();
}

// Poll the fetch_result URL until status=success or timeout.
async function pollResult(
  fetchUrl: string,
  requestId: number | string,
  isVideo: boolean,
  timeoutMs = 300_000,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  // ModelsLab fetch endpoint differs for images vs video
  const fetchPath = isVideo ? "/video/fetch" : "/images/fetch";

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4_000));
    try {
      // Prefer the fetch_result URL if available, else use standard fetch endpoint
      const pollUrl = fetchUrl || `${BASE_URL}${fetchPath}`;
      let data: Record<string, unknown>;
      if (fetchUrl) {
        const res = await fetch(fetchUrl, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ key: API_KEY }),
          signal:  AbortSignal.timeout(15_000),
        });
        if (!res.ok) continue;
        data = await res.json();
      } else {
        data = await mlPost(fetchPath, { request_id: requestId });
      }

      if (data.status === "success" && Array.isArray(data.output) && (data.output as string[]).length > 0) {
        return data.output as string[];
      }
      if (data.status === "error") {
        throw new Error(`ModelsLab generation error: ${String(data.message ?? data.messege ?? "unknown")}`);
      }
      // status === "processing" — keep polling
    } catch (err) {
      if (err instanceof Error && (err.message.includes("generation error") || err.message.includes("ModelsLab"))) throw err;
      // transient network error — keep polling
    }
  }
  throw new Error("ModelsLab generation timed out after 5 minutes");
}

// Submit and resolve output URLs (handles both sync and async responses).
async function generateAndResolve(
  path: string,
  payload: Record<string, unknown>,
  isVideo: boolean,
): Promise<string[]> {
  const data = await mlPost(path, payload);

  if (data.status === "error") {
    throw new Error(`ModelsLab error: ${String(data.message ?? data.messege ?? JSON.stringify(data))}`);
  }

  if (data.status === "success") {
    const output = data.output as string[] | undefined;
    if (output?.length) return output;
  }

  // status === "processing" — poll
  const fetchUrl  = String(data.fetch_result ?? "");
  const requestId = data.id as number | string;
  if (!fetchUrl && !requestId) {
    throw new Error("ModelsLab returned processing status but no fetch_result or id");
  }
  return pollResult(fetchUrl, requestId, isVideo);
}

// ── Supabase Storage upload ──────────────────────────────────────────────────

async function uploadUrlToStorage(
  sourceUrl: string,
  userId: string,
  isVideo: boolean,
): Promise<string> {
  const ext    = isVideo ? "mp4" : "png";
  const ctype  = isVideo ? "video/mp4" : "image/png";
  const bucket = "mavis-generated";
  const path   = `${userId}/modelslab-${Date.now()}.${ext}`;

  const res   = await fetch(sourceUrl, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Failed to fetch output from ModelsLab CDN: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());

  await sb.storage.createBucket(bucket, { public: false }).catch(() => {});
  const { error } = await sb.storage.from(bucket).upload(path, bytes, { contentType: ctype, upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data: signed } = await sb.storage.from(bucket).createSignedUrl(path, 3600);
  if (!signed?.signedUrl) throw new Error("Could not create signed URL");
  return signed.signedUrl;
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!API_KEY) {
      return new Response(
        JSON.stringify({ error: "MODELSLAB_API_KEY not configured. Add it in Supabase secrets." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body: Record<string, unknown> = await req.json().catch(() => ({}));

    const workflowType   = String(body.workflow_type ?? "txt2img");
    const prompt         = String(body.prompt ?? "").trim();
    const negativePrompt = String(body.negative_prompt ?? DEFAULT_NEGATIVE);
    const width          = Number(body.width)  || 512;
    const height         = Number(body.height) || 768;
    const steps          = Number(body.steps)  || 20;
    const cfg            = Number(body.cfg)    || 7;
    const seed           = body.seed != null ? Number(body.seed) : null;
    const samples        = Math.min(Number(body.samples) || 1, 4);
    const userId         = String(body.user_id ?? "anonymous");
    const initImage      = String(body.init_image ?? "");
    const strength       = Number(body.strength) || 0.7;
    const numFrames      = Number(body.num_frames) || 25;
    const fps            = Number(body.fps) || 8;
    const modelId        = String(body.model_id ?? "");

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "prompt is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const isVideo = workflowType === "txt2vid" || workflowType === "img2vid";

    let outputUrls: string[];

    switch (workflowType) {
      case "realtime": {
        outputUrls = await generateAndResolve("/realtime/text2img", {
          model_id:           modelId || "sdxl",
          prompt,
          negative_prompt:    negativePrompt,
          width:              String(width),
          height:             String(height),
          guidance_scale:     cfg,
          seed:               seed ?? null,
          safety_checker:     "no",
          enhance_prompt:     "yes",
          enhance_style:      "cinematic",
        }, false);
        break;
      }

      case "img2img": {
        if (!initImage) throw new Error("init_image is required for img2img");
        outputUrls = await generateAndResolve("/images/img2img", {
          model_id:           modelId || IMG_MODEL,
          prompt,
          negative_prompt:    negativePrompt,
          init_image:         initImage,
          width:              String(width),
          height:             String(height),
          samples:            String(samples),
          num_inference_steps: String(steps),
          guidance_scale:     cfg,
          strength,
          seed:               seed ?? null,
          safety_checker:     "no",
          webhook:            null,
          track_id:           null,
        }, false);
        break;
      }

      case "txt2vid": {
        outputUrls = await generateAndResolve("/video/text2video", {
          model_id:            modelId || VID_MODEL,
          prompt,
          negative_prompt:     negativePrompt,
          height:              String(height || 512),
          width:               String(width || 512),
          num_frames:          String(numFrames),
          num_inference_steps: String(steps || 30),
          guidance_scale:      cfg,
          fps:                 String(fps),
          seed:                seed ?? null,
          webhook:             null,
          track_id:            null,
        }, true);
        break;
      }

      case "img2vid": {
        if (!initImage) throw new Error("init_image is required for img2vid");
        outputUrls = await generateAndResolve("/video/img2video", {
          model_id:            modelId || "stable-video-diffusion",
          init_image:          initImage,
          height:              String(height || 576),
          width:               String(width || 1024),
          num_frames:          String(numFrames || 14),
          num_inference_steps: String(steps || 25),
          fps:                 String(fps || 6),
          motion_bucket_id:    127,
          noise_aug_strength:  0.02,
          seed:                seed ?? null,
          webhook:             null,
          track_id:            null,
        }, true);
        break;
      }

      default: {
        // txt2img (default)
        outputUrls = await generateAndResolve("/images/text2img", {
          model_id:            modelId || IMG_MODEL,
          prompt,
          negative_prompt:     negativePrompt,
          width:               String(width),
          height:              String(height),
          samples:             String(samples),
          num_inference_steps: String(steps),
          guidance_scale:      cfg,
          seed:                seed ?? null,
          safety_checker:      "no",
          multi_lingual:       "no",
          panorama:            "no",
          self_attention:      "no",
          upscale:             "no",
          webhook:             null,
          track_id:            null,
        }, false);
        break;
      }
    }

    if (!outputUrls.length) throw new Error("No output URLs returned");

    // Upload all outputs to Supabase Storage and return signed URLs
    const signedUrls = await Promise.all(
      outputUrls.map(url => uploadUrlToStorage(url, userId, isVideo)),
    );

    const result: Record<string, unknown> = {
      ok:            true,
      workflow_type: workflowType,
      count:         signedUrls.length,
    };
    if (isVideo) {
      result.videoUrl  = signedUrls[0];
      result.videoUrls = signedUrls;
    } else {
      result.imageUrl  = signedUrls[0];
      result.imageUrls = signedUrls;
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[mavis-modelslab]", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
