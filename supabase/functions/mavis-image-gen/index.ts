import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { generateImageCascade } from "../_shared/providers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { prompt, size, quality, aspect_ratio, width, height, provider, nsfw } = body;

    if (!prompt?.trim()) {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await generateImageCascade({
      prompt,
      size,
      quality,
      aspect_ratio,
      width,
      height,
      provider,
      nsfw,
    });

    return new Response(
      JSON.stringify({ ...result, revised_prompt: prompt }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("mavis-image-gen error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
