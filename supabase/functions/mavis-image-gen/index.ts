import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const OPENAI_KEY = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const FAL_KEY    = Deno.env.get("FAL_AI_API_KEY") ?? Deno.env.get("FAL_API_KEY") ?? "";
const MODELSLAB_KEY = Deno.env.get("MODELSLAB_API_KEY") ?? "";
// Self-hosted Stable Diffusion (AUTOMATIC1111 WebUI or Forge).
// Deploy: docker run -d -p 7860:7860 --gpus all abhinavsingh/stable-diffusion-webui
// Set: STABLE_DIFFUSION_URL=http://your-server:7860
const SD_URL = Deno.env.get("STABLE_DIFFUSION_URL") ?? "";
const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
// PromptChan — explicit/NSFW-capable image generation. ONLY ever invoked
// when the caller explicitly requests nsfw:true AND the calling account's
// profiles.nsfw_generation_enabled flag is true (checked server-side below,
// fail-closed — see the gate in serve()). Never part of the default SFW
// cascade.
const PROMPTCHAN_KEY = Deno.env.get("PROMPTCHAN_API_KEY") ?? "";
// Deliberately NOT hardcoded to a guessed domain — see CONFIDENCE NOTE below.
const PROMPTCHAN_BASE = Deno.env.get("PROMPTCHAN_API_BASE") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Lovable AI Gateway — free via workspace credits, high-quality Gemini image gen.
async function generateWithLovableAI(prompt: string): Promise<string | null> {
  if (!LOVABLE_KEY) return null;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
      method: "POST",
      headers: { "Authorization": `Bearer ${LOVABLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-image",
        messages: [{ role: "user", content: prompt.slice(0, 2000) }],
        modalities: ["image", "text"],
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) { console.warn("Lovable AI image failed:", res.status, await res.text().catch(() => "")); return null; }
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    return b64 ? `data:image/png;base64,${b64}` : null;
  } catch (e) { console.warn("Lovable AI image error:", e); return null; }
}

function pollinationsUrl(prompt: string, size: string): string {
  const [w, h] = parseDimensions(size);
  const encoded = encodeURIComponent(prompt.trim().slice(0, 500));
  const seed = Math.floor(Date.now() % 100000);
  return `https://image.pollinations.ai/prompt/${encoded}?width=${w}&height=${h}&model=flux&nologo=true&enhance=true&seed=${seed}`;
}


async function generateWithStableDiffusion(prompt: string, width = 512, height = 512): Promise<string | null> {
  if (!SD_URL) return null;
  try {
    const res = await fetch(`${SD_URL}/sdapi/v1/txt2img`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: prompt.slice(0, 1000),
        negative_prompt: "blurry, low quality, watermark, text, deformed, distorted",
        steps: 20,
        width,
        height,
        cfg_scale: 7,
        sampler_name: "DPM++ 2M",
        n_iter: 1,
        batch_size: 1,
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const b64 = data.images?.[0];
    return b64 ? `data:image/png;base64,${b64}` : null;
  } catch {
    return null;
  }
}

function parseDimensions(size = "1024x1024"): [number, number] {
  const [w, h] = size.split("x").map(Number);
  return [w || 512, h || 512];
}

// FLUX 1.1 [pro] Ultra — highest-quality photorealistic image generation via fal.ai
// Ultra endpoint renders up to 2K natively with sharper detail than v1.1 base.
async function generateWithFluxPro(prompt: string, size = "1024x1024"): Promise<string | null> {
  if (!FAL_KEY) return null;
  // Ultra endpoint uses aspect_ratio strings, not image_size objects.
  const [w, h] = parseDimensions(size);
  const ratio = w === h ? "1:1"
    : Math.abs(w / h - 16 / 9) < 0.05 ? "16:9"
    : Math.abs(w / h - 9 / 16) < 0.05 ? "9:16"
    : Math.abs(w / h - 4 / 3) < 0.05 ? "4:3"
    : Math.abs(w / h - 3 / 4) < 0.05 ? "3:4"
    : Math.abs(w / h - 21 / 9) < 0.05 ? "21:9"
    : w > h ? "16:9" : "9:16";
  const res = await fetch("https://fal.run/fal-ai/flux-pro/v1.1-ultra", {
    method: "POST",
    headers: { "Authorization": `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: prompt.trim().slice(0, 2000),
      aspect_ratio: ratio,
      num_images: 1,
      safety_tolerance: "6",
      output_format: "png",
      raw: false,
      enable_safety_checker: false,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("FLUX Pro Ultra error:", res.status, err.slice(0, 300));
    throw new Error(`FLUX Pro Ultra ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.images?.[0]?.url ?? null;
}

// ModelsLab — high-quality SDXL/FLUX-based generation, supports NSFW-friendly base models
async function generateWithModelsLab(prompt: string, size = "1024x1024"): Promise<string | null> {
  if (!MODELSLAB_KEY) return null;
  try {
    const [w, h] = parseDimensions(size);
    const res = await fetch("https://modelslab.com/api/v6/realtime/text2img", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: MODELSLAB_KEY,
        prompt: prompt.trim().slice(0, 2000),
        negative_prompt: "blurry, low quality, watermark, text, deformed",
        width: String(w),
        height: String(h),
        samples: "1",
        safety_checker: "no",
        enhance_prompt: "yes",
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.status === "error") return null;
    const url = Array.isArray(data?.output) ? data.output[0] : data?.output;
    return typeof url === "string" ? url : null;
  } catch {
    return null;
  }
}

async function generateWithImagen4(prompt: string, aspectRatio = "1:1"): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-preview-06-06:predict?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt: prompt.trim().slice(0, 2000) }],
        parameters: { sampleCount: 1, aspectRatio, safetyFilterLevel: "block_some" },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Imagen 4 ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error("Imagen 4 returned no image data");
  return `data:image/png;base64,${b64}`;
}

function normalizeOpenAiImageSize(size?: string): string {
  const allowed = new Set(["1024x1024", "1024x1536", "1536x1024", "auto"]);
  if (size && allowed.has(size)) return size;
  if (size === "1024x1792") return "1024x1536";
  if (size === "1792x1024") return "1536x1024";
  return "1024x1024";
}

function normalizeOpenAiImageQuality(quality?: string): string {
  const normalized = (quality ?? "low").toLowerCase();
  if (["low", "medium", "high", "auto"].includes(normalized)) return normalized;
  if (normalized === "hd") return "high";
  if (normalized === "standard") return "low";
  return "low";
}

async function generateWithOpenAiImage(prompt: string, size?: string, quality?: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt: prompt.trim(),
      n: 1,
      size: normalizeOpenAiImageSize(size),
      quality: normalizeOpenAiImageQuality(quality),
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`gpt-image-1 ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  const url = data.data?.[0]?.url;
  if (b64) return `data:image/png;base64,${b64}`;
  if (url) return url;
  throw new Error("gpt-image-1 returned no image");
}

// ⚠ CONFIDENCE NOTE — read before relying on this (same caveat class as
// mavis-composio-agent's, for the same reason: full API reference sits
// behind a logged-in developer dashboard, not publicly indexed).
// Independently confirmed via public sources: endpoint path is
// POST /api/external/create, auth is an `x-api-key` header, and a
// successful response is {image: <base64>, gems: <remaining balance>}.
// NOT independently confirmed: the base domain (PROMPTCHAN_API_BASE must
// be set from your own dashboard — nothing is hardcoded here on purpose,
// so a wrong guess can't send your API key/prompts to an unintended host)
// and the exact request-body field names beyond "prompt" (style/negative-
// prompt naming below is inferred from product UI copy, not a schema).
// Smoke-test with a throwaway prompt and a real API key before trusting
// this for anything.
async function generateWithPromptchan(prompt: string): Promise<string | null> {
  if (!PROMPTCHAN_KEY || !PROMPTCHAN_BASE) return null;
  const res = await fetch(`${PROMPTCHAN_BASE}/api/external/create`, {
    method: "POST",
    headers: { "x-api-key": PROMPTCHAN_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: prompt.trim().slice(0, 2000),
      style: "hyper-anime",
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PromptChan ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const b64 = data?.image;
  if (!b64) throw new Error("PromptChan returned no image data");
  return `data:image/png;base64,${b64}`;
}

// Resolves the calling user's id for the NSFW gate check only — the SFW
// cascade below stays exactly as unauthenticated-compatible as it always
// was (zero behavior change for existing callers). Mirrors the dual-path
// auth pattern already established in mavis-actions/index.ts: server-to-
// server callers (mavis-chat, telegram-webhook, etc.) present the service
// role key + an explicit userId in the body; frontend callers present the
// user's own JWT.
async function resolveCallingUserId(req: Request, body: Record<string, unknown>): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "");
  if (token === SUPABASE_SERVICE_ROLE_KEY && body.userId) return String(body.userId);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data?.user?.id) return null;
  return data.user.id;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { prompt, size, quality, aspect_ratio, width, height, provider: requestedProvider, nsfw } = body;
    if (!prompt?.trim()) {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // NSFW explicit-mode generation — fail-closed. This is the ONLY path
    // that ever touches PromptChan; everything below is the pre-existing
    // SFW cascade, unchanged. No userId → no enabled flag → no image, full
    // stop. This never silently falls back to an SFW provider on failure
    // (that would misleadingly hand back an unrelated image for what was
    // asked as an explicit request) — it fails loudly instead, matching
    // the no-silent-fallback rule used throughout this app's action layer.
    if (nsfw === true) {
      const callingUserId = await resolveCallingUserId(req, body);
      if (!callingUserId) {
        return new Response(JSON.stringify({ error: "NSFW generation requires authentication." }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data: profile } = await adminClient.from("profiles")
        .select("nsfw_generation_enabled").eq("id", callingUserId).maybeSingle();
      if (!profile?.nsfw_generation_enabled) {
        return new Response(JSON.stringify({ error: "NSFW generation is disabled for this account. Enable profiles.nsfw_generation_enabled to use it." }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!PROMPTCHAN_KEY || !PROMPTCHAN_BASE) {
        return new Response(JSON.stringify({ error: "PromptChan is not configured (PROMPTCHAN_API_KEY / PROMPTCHAN_API_BASE missing)." }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const imageData = await generateWithPromptchan(prompt);
      if (!imageData) {
        return new Response(JSON.stringify({ error: "PromptChan returned no image." }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ url: imageData, revised_prompt: prompt, provider: "promptchan", notes: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Support width/height as an alternative to size string. Default to HD.
    const effectiveSize: string =
      size ??
      (width && height ? `${width}x${height}` : "1024x1024");
    // Default quality is now "high" for crisper output.
    const effectiveQuality: string = quality ?? "high";
    const forced = typeof requestedProvider === "string" ? requestedProvider.toLowerCase() : "auto";

    let imageData: string | null = null;
    let provider = "unknown";
    const revised_prompt = prompt;
    const notes: string[] = [];

    // Try explicit provider first (if any); on failure, fall through to cascade.
    if (forced && forced !== "auto") {
      try {
        if (forced === "flux-pro" || forced === "flux") {
          if (!FAL_KEY) throw new Error("FAL_API_KEY missing");
          imageData = await generateWithFluxPro(prompt, effectiveSize);
          if (imageData) provider = "flux-pro";
        } else if (forced === "imagen-4" || forced === "imagen") {
          if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY missing");
          imageData = await generateWithImagen4(prompt, aspect_ratio ?? "1:1");
          if (imageData) provider = "imagen-4";
        } else if (forced === "openai" || forced === "gpt-image-1" || forced === "dalle") {
          if (!OPENAI_KEY) throw new Error("OPENAI_API missing");
          imageData = await generateWithOpenAiImage(prompt, effectiveSize, effectiveQuality);
          if (imageData) provider = "openai-gpt-image-1";
        } else if (forced === "modelslab" || forced === "seedream") {
          if (!MODELSLAB_KEY) throw new Error("MODELSLAB_API_KEY missing");
          imageData = await generateWithModelsLab(prompt, effectiveSize);
          if (imageData) provider = "modelslab";
        } else if (forced === "stable-diffusion" || forced === "sd") {
          if (!SD_URL) throw new Error("STABLE_DIFFUSION_URL missing");
          const [w, h] = parseDimensions(effectiveSize);
          imageData = await generateWithStableDiffusion(prompt, w, h);
          if (imageData) provider = "stable-diffusion";
        } else if (forced === "lovable" || forced === "gemini-image") {
          imageData = await generateWithLovableAI(prompt);
          if (imageData) provider = "lovable-ai";
        } else if (forced === "pollinations") {
          imageData = pollinationsUrl(prompt, effectiveSize);
          provider = "pollinations-flux";
        }
      } catch (e: any) {
        notes.push(`${forced} unavailable: ${e.message}`);
      }
      if (!imageData) notes.push(`${forced} failed — falling back`);
    }

    // Fallback cascade: free / credit-based first, then paid, then always-free Pollinations.
    if (!imageData && LOVABLE_KEY) {
      try { imageData = await generateWithLovableAI(prompt); if (imageData) provider = "lovable-ai"; }
      catch (e: any) { notes.push(`lovable-ai: ${e.message}`); }
    }
    if (!imageData && GEMINI_KEY) {
      try { imageData = await generateWithImagen4(prompt, aspect_ratio ?? "1:1"); if (imageData) provider = "imagen-4"; }
      catch (e: any) { notes.push(`imagen-4: ${e.message}`); }
    }
    if (!imageData && FAL_KEY) {
      try { const u = await generateWithFluxPro(prompt, effectiveSize); if (u) { imageData = u; provider = "flux-pro"; } }
      catch (e: any) { notes.push(`flux-pro: ${e.message}`); }
    }
    if (!imageData && MODELSLAB_KEY) {
      try { const u = await generateWithModelsLab(prompt, effectiveSize); if (u) { imageData = u; provider = "modelslab"; } }
      catch (e: any) { notes.push(`modelslab: ${e.message}`); }
    }
    if (!imageData && OPENAI_KEY) {
      try { imageData = await generateWithOpenAiImage(prompt, effectiveSize, effectiveQuality); if (imageData) provider = "openai-gpt-image-1"; }
      catch (e: any) { notes.push(`openai: ${e.message}`); }
    }
    if (!imageData && SD_URL) {
      const [w, h] = parseDimensions(effectiveSize);
      imageData = await generateWithStableDiffusion(prompt, w, h);
      if (imageData) provider = "stable-diffusion";
    }
    if (!imageData) {
      imageData = pollinationsUrl(prompt, effectiveSize);
      provider = "pollinations-flux";
    }

    return new Response(
      JSON.stringify({ url: imageData, revised_prompt, provider, notes }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("mavis-image-gen error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
