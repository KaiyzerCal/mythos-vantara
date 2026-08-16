import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { submitVideoCascade, videoPollHandlers } from "../_shared/providers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface VideoRequest {
  prompt: string;
  duration?: number;
  aspect_ratio?: string;
  provider?: string;
  model?: string;
  image_url?: string;
  action?: "generate" | "poll";
  request_id?: string;
  operation_name?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: VideoRequest = await req.json();
    const { prompt, duration, aspect_ratio, provider, model, image_url, action, request_id, operation_name } = body;

    // ── Poll path ────────────────────────────────────────────────────────────
    if (action === "poll") {
      if (!provider || provider === "auto") {
        return new Response(JSON.stringify({ error: "provider required for poll" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const pollId = request_id ?? operation_name;
      if (!pollId) {
        return new Response(JSON.stringify({ error: "request_id or operation_name required for poll" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const handler = videoPollHandlers[provider.toLowerCase()];
      if (!handler) {
        return new Response(JSON.stringify({ error: "unknown provider" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const result = await handler(pollId, model);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Generate path ────────────────────────────────────────────────────────
    if (!prompt?.trim()) {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await submitVideoCascade({
      prompt,
      duration,
      aspect_ratio,
      provider,
      model,
      image_url,
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("mavis-video-gen error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
