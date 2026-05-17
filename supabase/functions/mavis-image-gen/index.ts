import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt, size, quality } = await req.json();

    if (!prompt?.trim()) {
      return new Response(
        JSON.stringify({ error: "prompt is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const openaiKey = Deno.env.get("OPENAI_API");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
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
      const errText = await res.text();
      console.error("DALL-E 3 error:", res.status, errText);
      return new Response(
        JSON.stringify({ error: `Image generation failed (${res.status})` }),
        { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await res.json();
    const imageUrl: string = data.data?.[0]?.url ?? "";
    const revisedPrompt: string = data.data?.[0]?.revised_prompt ?? prompt;

    return new Response(
      JSON.stringify({ url: imageUrl, revised_prompt: revisedPrompt }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("mavis-image-gen error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
