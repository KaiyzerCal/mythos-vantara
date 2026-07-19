// mavis-comfyui
// Self-hosted ComfyUI integration for MAVIS — image and video generation.
// Submits workflows to the ComfyUI API, polls for completion, uploads output
// to Supabase Storage, and returns a signed URL usable by Telegram/web.
//
// Required env vars:
//   COMFYUI_URL              — e.g. http://your-server:8188 (no trailing slash)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Optional env vars (images):
//   COMFYUI_DEFAULT_MODEL    — checkpoint .safetensors filename (default: v1-5-pruned-emaonly.safetensors)
//   COMFYUI_HQ_MODEL         — higher-quality checkpoint for portrait workflow
//   COMFYUI_VIDEO_MODEL      — AnimateDiff motion module filename for txt2vid
//   COMFYUI_API_KEY          — Bearer token if ComfyUI is behind auth proxy
//
// Optional env vars (Wan2.2 video):
//   WAN_T2V_MODEL            — Wan2.2 text-to-video checkpoint (default: wan2.2-T2V-14B-fp8.safetensors)
//   WAN_I2V_MODEL            — Wan2.2 image-to-video checkpoint (default: wan2.2-I2V-14B-fp8.safetensors)
//   WAN_S2V_MODEL            — Wan2.2 speech/audio-to-video checkpoint (default: wan2.2-S2V-14B-fp8.safetensors)
//   WAN_T5_ENCODER           — UMT5 text encoder GGUF (default: umt5-xxl-encoder-Q8_0.gguf)
//   WAN_VAE                  — Wan VAE (default: wan_2.2_vae.safetensors)
//   WAN_CLIP                 — CLIP vision encoder (default: clip_vision_h.safetensors)
//
// Workflow types:
//   txt2img      — standard quality image (512–1024px)
//   portrait     — higher quality, portrait-oriented, more steps (DPM++ 2M Karras)
//   concept      — concept art / illustration style
//   txt2vid      — short video via AnimateDiff (requires ComfyUI-AnimateDiff-Evolved)
//   wan_t2v      — Wan2.2 text-to-video (requires ComfyUI-WanVideoWrapper)
//   wan_i2v      — Wan2.2 image-to-video; requires reference_image_url (requires ComfyUI-WanVideoWrapper)
//   talking_head — Wan2.2 S2V lip-sync from reference image + audio; requires reference_image_url + audio_url

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const COMFYUI_URL   = Deno.env.get("COMFYUI_URL") ?? "";
const COMFYUI_KEY   = Deno.env.get("COMFYUI_API_KEY") ?? "";
const DEFAULT_MODEL = Deno.env.get("COMFYUI_DEFAULT_MODEL") ?? "v1-5-pruned-emaonly.safetensors";
const HQ_MODEL      = Deno.env.get("COMFYUI_HQ_MODEL") ?? DEFAULT_MODEL;
const VIDEO_MODEL   = Deno.env.get("COMFYUI_VIDEO_MODEL") ?? "mm_sd_v15_v2.ckpt";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const WAN_T2V_MODEL  = Deno.env.get("WAN_T2V_MODEL")  ?? "wan2.2-T2V-14B-fp8.safetensors";
const WAN_I2V_MODEL  = Deno.env.get("WAN_I2V_MODEL")  ?? "wan2.2-I2V-14B-fp8.safetensors";
const WAN_S2V_MODEL  = Deno.env.get("WAN_S2V_MODEL")  ?? "wan2.2-S2V-14B-fp8.safetensors";
const WAN_T5_ENCODER = Deno.env.get("WAN_T5_ENCODER") ?? "umt5-xxl-encoder-Q8_0.gguf";
const WAN_VAE        = Deno.env.get("WAN_VAE")        ?? "wan_2.2_vae.safetensors";
const WAN_CLIP       = Deno.env.get("WAN_CLIP")       ?? "clip_vision_h.safetensors";

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const DEFAULT_NEGATIVE = "blurry, low quality, watermark, text, deformed, distorted, ugly, bad anatomy, extra limbs, clipped, jpeg artifacts, signature";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

// ── ComfyUI workflow templates ───────────────────────────────────────────────

function seedRandom(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

function buildTxt2ImgWorkflow(
  prompt: string,
  negativePrompt: string,
  width: number,
  height: number,
  steps: number,
  cfg: number,
  model: string,
  seed: number,
): Record<string, unknown> {
  return {
    "4":  { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: model } },
    "5":  { class_type: "EmptyLatentImage",        inputs: { width, height, batch_size: 1 } },
    "6":  { class_type: "CLIPTextEncode",          inputs: { text: prompt,         clip: ["4", 1] } },
    "7":  { class_type: "CLIPTextEncode",          inputs: { text: negativePrompt, clip: ["4", 1] } },
    "3":  { class_type: "KSampler",               inputs: {
      seed, steps, cfg,
      sampler_name: "euler", scheduler: "normal", denoise: 1,
      model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0],
    }},
    "8":  { class_type: "VAEDecode",  inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9":  { class_type: "SaveImage",  inputs: { filename_prefix: "mavis", images: ["8", 0] } },
  };
}

function buildPortraitWorkflow(
  prompt: string,
  negativePrompt: string,
  seed: number,
): Record<string, unknown> {
  const enhancedPrompt = `${prompt}, portrait, detailed face, professional photography, sharp focus, high detail`;
  return {
    "4":  { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: HQ_MODEL } },
    "5":  { class_type: "EmptyLatentImage",        inputs: { width: 768, height: 1024, batch_size: 1 } },
    "6":  { class_type: "CLIPTextEncode",          inputs: { text: enhancedPrompt, clip: ["4", 1] } },
    "7":  { class_type: "CLIPTextEncode",          inputs: { text: negativePrompt, clip: ["4", 1] } },
    "3":  { class_type: "KSampler", inputs: {
      seed, steps: 30, cfg: 7.5,
      sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 1,
      model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0],
    }},
    "8":  { class_type: "VAEDecode",  inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9":  { class_type: "SaveImage",  inputs: { filename_prefix: "mavis_portrait", images: ["8", 0] } },
  };
}

function buildConceptWorkflow(
  prompt: string,
  negativePrompt: string,
  seed: number,
): Record<string, unknown> {
  const enhancedPrompt = `${prompt}, concept art, digital painting, illustration, artstation, detailed, vivid colors`;
  return {
    "4":  { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: DEFAULT_MODEL } },
    "5":  { class_type: "EmptyLatentImage",        inputs: { width: 768, height: 768, batch_size: 1 } },
    "6":  { class_type: "CLIPTextEncode",          inputs: { text: enhancedPrompt, clip: ["4", 1] } },
    "7":  { class_type: "CLIPTextEncode",          inputs: { text: negativePrompt + ", photo, realistic", clip: ["4", 1] } },
    "3":  { class_type: "KSampler", inputs: {
      seed, steps: 25, cfg: 8,
      sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 1,
      model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0],
    }},
    "8":  { class_type: "VAEDecode",  inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9":  { class_type: "SaveImage",  inputs: { filename_prefix: "mavis_concept", images: ["8", 0] } },
  };
}

// AnimateDiff txt2vid — requires the AnimateDiff ComfyUI extension and motion modules.
// Install: https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved
function buildAnimateDiffWorkflow(
  prompt: string,
  negativePrompt: string,
  seed: number,
): Record<string, unknown> {
  return {
    "4":   { class_type: "CheckpointLoaderSimple",           inputs: { ckpt_name: DEFAULT_MODEL } },
    "10":  { class_type: "ADE_AnimateDiffLoaderWithContext", inputs: { model_name: VIDEO_MODEL, beta_schedule: "sqrt_linear (AnimateDiff)" } },
    "11":  { class_type: "ADE_UseEvolvedSampling",           inputs: { model: ["4", 0], m_models: ["10", 0] } },
    "5":   { class_type: "EmptyLatentImage",                 inputs: { width: 512, height: 512, batch_size: 16 } },
    "6":   { class_type: "CLIPTextEncode",                   inputs: { text: prompt,         clip: ["4", 1] } },
    "7":   { class_type: "CLIPTextEncode",                   inputs: { text: negativePrompt, clip: ["4", 1] } },
    "3":   { class_type: "KSampler", inputs: {
      seed, steps: 20, cfg: 7,
      sampler_name: "euler", scheduler: "normal", denoise: 1,
      model: ["11", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0],
    }},
    "8":   { class_type: "VAEDecode",        inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "12":  { class_type: "VHS_VideoCombine", inputs: { images: ["8", 0], frame_rate: 8, loop_count: 0, filename_prefix: "mavis_video", format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

// Wan2.2 text-to-video — requires ComfyUI-WanVideoWrapper.
// Install: https://github.com/kijai/ComfyUI-WanVideoWrapper
function buildWan22T2VWorkflow(
  prompt: string,
  negativePrompt: string,
  width: number,
  height: number,
  frames: number,
  seed: number,
): Record<string, unknown> {
  return {
    "1": { class_type: "WanVideoModelLoader",       inputs: { model: WAN_T2V_MODEL, precision: "fp8_e4m3fn", load_device: "offload_device" } },
    "2": { class_type: "LoadWanVideoT5TextEncoder", inputs: { t5: WAN_T5_ENCODER, precision: "fp8_e4m3fn", load_device: "offload_device" } },
    "3": { class_type: "WanVideoTextEncode",        inputs: { positive_prompt: prompt, negative_prompt: negativePrompt, t5: ["2", 0], force_offload: true } },
    "4": { class_type: "VAELoader",                 inputs: { vae_name: WAN_VAE } },
    "5": { class_type: "EmptyWanLatentVideo",       inputs: { batch_size: 1, frames, width, height } },
    "6": { class_type: "WanVideoSampler",           inputs: {
      steps: 30, cfg: 6.0, shift: 8.0, seed, force_offload: true, scheduler: "unipc",
      model: ["1", 0], positive: ["3", 0], negative: ["3", 1], latents: ["5", 0],
    }},
    "7": { class_type: "WanVideoVAEDecode",   inputs: { enable_vae_tiling: true, auto_tile_size: true, vae: ["4", 0], samples: ["6", 0] } },
    "8": { class_type: "VHS_VideoCombine",    inputs: { frame_rate: 16, loop_count: 0, filename_prefix: "mavis_wan22_t2v", format: "video/h264-mp4", pingpong: false, save_output: true, images: ["7", 0] } },
  };
}

// Wan2.2 image-to-video — requires ComfyUI-WanVideoWrapper.
// reference_image_url must be a publicly accessible image URL.
function buildWan22I2VWorkflow(
  prompt: string,
  negativePrompt: string,
  referenceImageUrl: string,
  width: number,
  height: number,
  frames: number,
  seed: number,
): Record<string, unknown> {
  return {
    "1":  { class_type: "WanVideoModelLoader",          inputs: { model: WAN_I2V_MODEL, precision: "fp8_e4m3fn", load_device: "offload_device" } },
    "2":  { class_type: "LoadWanVideoT5TextEncoder",    inputs: { t5: WAN_T5_ENCODER, precision: "fp8_e4m3fn", load_device: "offload_device" } },
    "3":  { class_type: "LoadWanVideoClipImageEncoder", inputs: { clip_name: WAN_CLIP, precision: "fp8_e4m3fn" } },
    "4":  { class_type: "VAELoader",                    inputs: { vae_name: WAN_VAE } },
    "5":  { class_type: "LoadImageFromUrl",             inputs: { url: referenceImageUrl } },
    "6":  { class_type: "WanImageToVideoLatent",        inputs: { width, height, length: frames, batch_size: 1, image: ["5", 0], vae: ["4", 0] } },
    "7":  { class_type: "WanVideoTextEncode",           inputs: { positive_prompt: prompt, negative_prompt: negativePrompt, t5: ["2", 0], force_offload: true } },
    "8":  { class_type: "WanVideoImageClipEncode",      inputs: { clip_vision: ["3", 0], image: ["5", 0], vae: ["4", 0], generation_width: width, generation_height: height, length: frames } },
    "9":  { class_type: "WanVideoSampler",              inputs: {
      steps: 30, cfg: 6.0, shift: 5.0, seed, force_offload: true, scheduler: "unipc",
      model: ["1", 0], positive: ["7", 0], negative: ["7", 1], image_embeds: ["8", 0], latents: ["6", 0],
    }},
    "10": { class_type: "WanVideoVAEDecode",  inputs: { enable_vae_tiling: true, auto_tile_size: true, vae: ["4", 0], samples: ["9", 0] } },
    "11": { class_type: "VHS_VideoCombine",   inputs: { frame_rate: 16, loop_count: 0, filename_prefix: "mavis_wan22_i2v", format: "video/h264-mp4", pingpong: false, save_output: true, images: ["10", 0] } },
  };
}

// Wan2.2 S2V talking head — lip-syncs a reference image to an audio file.
// Requires ComfyUI-WanVideoWrapper with S2V support.
// reference_image_url — publicly accessible portrait/face image URL.
// audioUrl — URL to audio file (mp3/wav) accessible by ComfyUI, or a path
//            to a file already present in ComfyUI's input directory.
function buildTalkingHeadWorkflow(
  prompt: string,
  negativePrompt: string,
  referenceImageUrl: string,
  audioUrl: string,
  seed: number,
): Record<string, unknown> {
  return {
    "1":  { class_type: "WanVideoModelLoader",          inputs: { model: WAN_S2V_MODEL, precision: "fp8_e4m3fn", load_device: "offload_device" } },
    "2":  { class_type: "LoadWanVideoT5TextEncoder",    inputs: { t5: WAN_T5_ENCODER, precision: "fp8_e4m3fn", load_device: "offload_device" } },
    "3":  { class_type: "LoadWanVideoClipImageEncoder", inputs: { clip_name: WAN_CLIP, precision: "fp8_e4m3fn" } },
    "4":  { class_type: "VAELoader",                    inputs: { vae_name: WAN_VAE } },
    "5":  { class_type: "LoadImageFromUrl",             inputs: { url: referenceImageUrl } },
    "6":  { class_type: "VHS_LoadAudio",                inputs: { audio_file: audioUrl, seek_seconds: 0.0 } },
    "7":  { class_type: "WanVideoTextEncode",           inputs: {
      positive_prompt: `${prompt}, talking, natural facial movement, lip sync`,
      negative_prompt: negativePrompt,
      t5: ["2", 0],
      force_offload: true,
    }},
    "8":  { class_type: "WanVideoImageClipEncode",      inputs: { clip_vision: ["3", 0], image: ["5", 0], vae: ["4", 0], generation_width: 512, generation_height: 512, length: 81 } },
    "9":  { class_type: "WanVideoSampler",              inputs: {
      steps: 30, cfg: 6.0, shift: 5.0, seed, force_offload: true, scheduler: "unipc",
      model: ["1", 0], positive: ["7", 0], negative: ["7", 1], image_embeds: ["8", 0], audio: ["6", 0],
    }},
    "10": { class_type: "WanVideoVAEDecode",  inputs: { enable_vae_tiling: true, auto_tile_size: true, vae: ["4", 0], samples: ["9", 0] } },
    "11": { class_type: "VHS_VideoCombine",   inputs: { frame_rate: 25, loop_count: 0, filename_prefix: "mavis_talking_head", format: "video/h264-mp4", pingpong: false, save_output: true, images: ["10", 0], audio: ["6", 0] } },
  };
}

function selectWorkflow(
  workflowType: string,
  prompt: string,
  negPrompt: string,
  width: number,
  height: number,
  steps: number,
  cfg: number,
  seed: number,
  referenceImageUrl?: string,
  audioUrl?: string,
  frames?: number,
): Record<string, unknown> {
  const f = frames ?? (workflowType === "txt2vid" || workflowType === "wan_t2v" ? 81 : 0);
  switch (workflowType) {
    case "portrait":     return buildPortraitWorkflow(prompt, negPrompt, seed);
    case "concept":      return buildConceptWorkflow(prompt, negPrompt, seed);
    case "txt2vid":      return buildAnimateDiffWorkflow(prompt, negPrompt, seed);
    case "wan_t2v":      return buildWan22T2VWorkflow(prompt, negPrompt, width || 832, height || 480, f, seed);
    case "wan_i2v":      return buildWan22I2VWorkflow(prompt, negPrompt, referenceImageUrl ?? "", width || 832, height || 480, f, seed);
    case "talking_head": return buildTalkingHeadWorkflow(prompt, negPrompt, referenceImageUrl ?? "", audioUrl ?? "", seed);
    default:             return buildTxt2ImgWorkflow(prompt, negPrompt, width, height, steps, cfg, DEFAULT_MODEL, seed);
  }
}

// ── ComfyUI API ──────────────────────────────────────────────────────────────

function comfyHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (COMFYUI_KEY) h["Authorization"] = `Bearer ${COMFYUI_KEY}`;
  return h;
}

async function submitWorkflow(workflow: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${COMFYUI_URL}/prompt`, {
    method:  "POST",
    headers: comfyHeaders(),
    body:    JSON.stringify({ prompt: workflow, client_id: "mavis" }),
    signal:  AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`ComfyUI /prompt failed: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const promptId = data?.prompt_id as string | undefined;
  if (!promptId) throw new Error("ComfyUI returned no prompt_id");
  return promptId;
}

async function pollCompletion(
  promptId: string,
  isVideo: boolean,
  timeoutMs = 300_000,
): Promise<{ filename: string; isVideo: boolean }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const res = await fetch(`${COMFYUI_URL}/history/${promptId}`, {
        headers: comfyHeaders(),
        signal:  AbortSignal.timeout(8_000),
      });
      if (!res.ok) continue;
      const history = await res.json();
      const entry   = history[promptId];
      if (!entry) continue;

      const status = entry.status;
      if (status?.status_str === "error") {
        const msgs = (status.messages ?? []).map((m: any) => String(m[1] ?? "")).join("; ");
        throw new Error(`ComfyUI generation error: ${msgs.slice(0, 200)}`);
      }
      if (!status?.completed) continue;

      // Extract output filename from node outputs
      const outputs = entry.outputs as Record<string, any>;
      for (const nodeOutput of Object.values(outputs)) {
        if (nodeOutput?.images?.length) {
          return { filename: nodeOutput.images[0].filename as string, isVideo: false };
        }
        if (nodeOutput?.videos?.length) {
          return { filename: nodeOutput.videos[0].filename as string, isVideo: true };
        }
        if (nodeOutput?.gifs?.length) {
          return { filename: nodeOutput.gifs[0].filename as string, isVideo: true };
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("ComfyUI generation error")) throw err;
      // Network hiccup — keep polling
    }
  }
  throw new Error("ComfyUI generation timed out after 5 minutes");
}

async function downloadOutput(filename: string, isVideo: boolean): Promise<{ bytes: Uint8Array; contentType: string }> {
  const subfolder = "";
  const type = "output";
  const url = `${COMFYUI_URL}/view?filename=${encodeURIComponent(filename)}&subfolder=${subfolder}&type=${type}`;
  const res = await fetch(url, { headers: comfyHeaders(), signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`ComfyUI /view failed: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ext = filename.split(".").pop()?.toLowerCase() ?? "png";
  const contentType = isVideo
    ? (ext === "gif" ? "image/gif" : "video/mp4")
    : (ext === "webp" ? "image/webp" : "image/png");
  return { bytes, contentType };
}

// ── Supabase Storage upload ──────────────────────────────────────────────────

async function uploadToStorage(
  bytes: Uint8Array,
  contentType: string,
  filename: string,
  userId: string,
): Promise<string> {
  const bucket = "mavis-generated";
  const path   = `${userId}/${Date.now()}-${filename}`;

  // Ensure bucket exists (ignore error if already exists)
  await sb.storage.createBucket(bucket, { public: false }).catch(() => {});

  const { error } = await sb.storage.from(bucket).upload(path, bytes, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data: signedData } = await sb.storage.from(bucket).createSignedUrl(path, 3600);
  if (!signedData?.signedUrl) throw new Error("Could not create signed URL");

  return signedData.signedUrl;
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!COMFYUI_URL) {
      return new Response(
        JSON.stringify({ error: "COMFYUI_URL not configured. Set it in Supabase secrets." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body: Record<string, unknown> = await req.json().catch(() => ({}));
    const prompt            = String(body.prompt ?? "").trim();
    const workflowType      = String(body.workflow_type ?? "txt2img");
    const negativePrompt    = String(body.negative_prompt ?? DEFAULT_NEGATIVE);
    const width             = Number(body.width)  || (workflowType === "portrait" ? 768 : 512);
    const height            = Number(body.height) || (workflowType === "portrait" ? 1024 : 512);
    const steps             = Number(body.steps)  || 20;
    const cfg               = Number(body.cfg)    || 7;
    const userId            = String(body.user_id ?? "anonymous");
    const seed              = Number(body.seed)   || seedRandom();
    const referenceImageUrl = String(body.reference_image_url ?? "");
    const audioUrl          = String(body.audio_url ?? "");
    const frames            = Number(body.frames) || undefined;

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "prompt is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const isVideo = ["txt2vid", "wan_t2v", "wan_i2v", "talking_head"].includes(workflowType);

    // Build and submit workflow
    const workflow = selectWorkflow(workflowType, prompt, negativePrompt, width, height, steps, cfg, seed, referenceImageUrl, audioUrl, frames);
    const promptId = await submitWorkflow(workflow);

    // Poll for completion
    const { filename, isVideo: actuallyVideo } = await pollCompletion(promptId, isVideo);

    // Download output from ComfyUI
    const { bytes, contentType } = await downloadOutput(filename, actuallyVideo);

    // Upload to Supabase Storage and get signed URL
    const signedUrl = await uploadToStorage(bytes, contentType, filename, userId);

    const result: Record<string, unknown> = {
      ok:            true,
      prompt_id:     promptId,
      filename,
      workflow_type: workflowType,
      seed,
    };
    if (actuallyVideo) {
      result.videoUrl = signedUrl;
    } else {
      result.imageUrl = signedUrl;
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[mavis-comfyui]", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
