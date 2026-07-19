import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const OPENAI_KEY = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const FAL_KEY    = Deno.env.get("FAL_API_KEY") ?? "";
// Self-hosted Stable Diffusion (AUTOMATIC1111 WebUI or Forge).
// Deploy: docker run -d -p 7860:7860 --gpus all abhinavsingh/stable-diffusion-webui
// Set: STABLE_DIFFUSION_URL=http://your-server:7860
const SD_URL = Deno.env.get("STABLE_DIFFUSION_URL") ?? "";

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

// FLUX 1.1 Pro — highest-quality photorealistic image generation via fal.ai
// Inserted between Imagen 4 and DALL-E 3 so it catches failures from either.
async function generateWithFluxPro(prompt: string, size = "square_hd"): Promise<string | null> {
  if (!FAL_KEY) return null;
  try {
    const sizeMap: Record<string, string> = {
      "1024x1024": "square_hd",
      "1792x1024": "landscape_16_9",
      "1024x1792": "portrait_16_9",
    };
    const imageSize = sizeMap[size] ?? size;
    const res = await fetch("https://fal.run/fal-ai/flux-pro/v1.1", {
      method: "POST",
      headers: { "Authorization": `Key ${FAL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt.trim().slice(0, 2000), image_size: imageSize, num_images: 1, safety_tolerance: "2" }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.images?.[0]?.url ?? null;
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

async function generateWithDallE3(prompt: string, size: string, quality: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt: prompt.trim(),
      n: 1,
      size: size ?? "1024x1024",
      quality: quality ?? "standard",
      response_format: "url",
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DALL-E 3 ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const url = data.data?.[0]?.url;
  if (!url) throw new Error("DALL-E 3 returned no URL");
  return url;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, size, quality, aspect_ratio } = await req.json();
    if (!prompt?.trim()) {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let imageData: string | null = null;
    let provider = "unknown";
    let revised_prompt = prompt;

    // Tier 0 — Self-hosted Stable Diffusion (free, unlimited)
    if (SD_URL) {
      const [w, h] = parseDimensions(size ?? "512x512");
      imageData = await generateWithStableDiffusion(prompt, w, h);
      if (imageData) provider = "stable-diffusion";
    }

    // Tier 1 — Imagen 4 (Google, free tier)
    if (!imageData && GEMINI_KEY) {
      try {
        imageData = await generateWithImagen4(prompt, aspect_ratio ?? "1:1");
        provider = "imagen-4";
      } catch (e: any) {
        console.warn("Imagen 4 failed, falling back to DALL-E:", e.message);
      }
    }

    // Tier 1.5 — FLUX 1.1 Pro (fal.ai, higher quality than DALL-E 3)
    if (!imageData && FAL_KEY) {
      try {
        const fluxUrl = await generateWithFluxPro(prompt, size ?? "1024x1024");
        if (fluxUrl) { imageData = fluxUrl; provider = "flux-pro"; }
      } catch (e: any) {
        console.warn("FLUX Pro failed, falling back to DALL-E 3:", e.message);
      }
    }

    // Tier 2 — DALL-E 3
    if (!imageData && OPENAI_KEY) {
      const url = await generateWithDallE3(prompt, size ?? "1024x1024", quality ?? "standard");
      imageData = url;
      provider = "dall-e-3";
    }

    // Tier 3 — Pollinations.ai (completely free, no API key required)
    // Runs when none of the above keys are configured; great for dev/demo.
    if (!imageData) {
      const [w, h] = parseDimensions(size ?? "1024x1024");
      const encoded = encodeURIComponent(prompt.trim().slice(0, 500));
      const seed = Math.floor(Date.now() % 100000);
      imageData = `https://image.pollinations.ai/prompt/${encoded}?width=${w}&height=${h}&model=flux&nologo=true&seed=${seed}`;
      provider = "pollinations-flux";
    }

    return new Response(
      JSON.stringify({ url: imageData, revised_prompt, provider }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("mavis-image-gen error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
