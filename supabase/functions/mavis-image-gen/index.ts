import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const OPENAI_KEY = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

async function generateWithImagen4(prompt: string, aspectRatio = "1:1"): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${GEMINI_KEY}`,
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

    // Try Imagen 4 first
    if (GEMINI_KEY) {
      try {
        imageData = await generateWithImagen4(prompt, aspect_ratio ?? "1:1");
        provider = "imagen-4";
      } catch (e: any) {
        console.warn("Imagen 4 failed, falling back to DALL-E:", e.message);
      }
    }

    // Fall back to DALL-E 3
    if (!imageData && OPENAI_KEY) {
      const url = await generateWithDallE3(prompt, size ?? "1024x1024", quality ?? "standard");
      imageData = url;
      provider = "dall-e-3";
    }

    if (!imageData) {
      return new Response(JSON.stringify({ error: "No image generation API available" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
