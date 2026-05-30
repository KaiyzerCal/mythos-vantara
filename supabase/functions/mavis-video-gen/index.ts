import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FAL_KEY = Deno.env.get("FAL_API_KEY") ?? "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";

type AspectRatio = "16:9" | "9:16" | "1:1";
type Provider = "fal" | "veo" | "omni" | "auto";

interface VideoRequest {
  prompt: string;
  duration?: number;
  aspect_ratio?: AspectRatio;
  provider?: Provider;
  model?: string;
  image_url?: string;
  action?: "generate" | "poll";
  request_id?: string;
  operation_name?: string;
}

// ── fal.ai ─────────────────────────────────────────────────────────────────

async function submitFalJob(
  prompt: string,
  duration: number,
  aspect_ratio: AspectRatio,
  model?: string
): Promise<{ status: string; request_id: string; provider: string; poll_url: string }> {
  const falModel = model ?? "fal-ai/veo3";
  const endpoint = `https://queue.fal.run/${falModel}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Key ${FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt, duration, aspect_ratio }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`fal.ai submit ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  const request_id: string = data.request_id;
  if (!request_id) throw new Error("fal.ai returned no request_id");
  const poll_url = `https://queue.fal.run/${falModel}/${request_id}`;
  return { status: "processing", request_id, provider: "fal", poll_url };
}

async function pollFalJob(
  request_id: string,
  model?: string
): Promise<{ status: string; url?: string; provider: string; duration?: number }> {
  const falModel = model ?? "fal-ai/veo3";
  const poll_url = `https://queue.fal.run/${falModel}/${request_id}`;
  const res = await fetch(poll_url, {
    headers: { "Authorization": `Key ${FAL_KEY}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`fal.ai poll ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  if (data.status === "COMPLETED" || data.video?.url) {
    const videoUrl = data.video?.url ?? data.output?.video?.url;
    if (!videoUrl) throw new Error("fal.ai job complete but no video URL found");
    return { status: "complete", url: videoUrl, provider: "fal" };
  }
  if (data.status === "FAILED" || data.error) {
    throw new Error(`fal.ai job failed: ${data.error ?? "unknown error"}`);
  }
  return { status: "processing", provider: "fal" };
}

// ── Veo 3.1 via Gemini API ──────────────────────────────────────────────────

async function submitVeoJob(
  prompt: string,
  aspect_ratio: AspectRatio
): Promise<{ status: string; operation_name: string; provider: string }> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/veo-3.0-generate-preview:predictLongRunning?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { aspectRatio: aspect_ratio ?? "16:9", sampleCount: 1 },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Veo submit ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  const operation_name: string = data.name;
  if (!operation_name) throw new Error("Veo returned no operation name");
  return { status: "processing", operation_name, provider: "veo" };
}

async function pollVeoOperation(
  operation_name: string
): Promise<{ status: string; url?: string; provider: string }> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${operation_name}?key=${GEMINI_KEY}`,
    { headers: { "Content-Type": "application/json" } }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Veo poll ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  if (data.done) {
    if (data.error) throw new Error(`Veo operation failed: ${JSON.stringify(data.error)}`);
    const videoUri =
      data.response?.predictions?.[0]?.video?.uri ??
      data.response?.predictions?.[0]?.videoUri;
    if (!videoUri) throw new Error("Veo operation done but no video URI found");
    return { status: "complete", url: videoUri, provider: "veo" };
  }
  return { status: "processing", provider: "veo" };
}

// ── Resolve provider ────────────────────────────────────────────────────────

function resolveProvider(requested?: Provider): "fal" | "veo" | "omni" {
  if (requested && requested !== "auto") return requested;
  if (FAL_KEY) return "fal";
  if (GEMINI_KEY) return "veo";
  throw new Error("No video generation API key configured (FAL_API_KEY or GEMINI_API_KEY required)");
}

// ── Handler ─────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body: VideoRequest = await req.json();
    const { prompt, duration, aspect_ratio, provider: requestedProvider, model, action, request_id, operation_name } = body;

    // ── Poll path ────────────────────────────────────────────────────────────
    if (action === "poll") {
      if (!requestedProvider || requestedProvider === "auto") {
        return new Response(JSON.stringify({ error: "provider required for poll" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      let result: Record<string, unknown>;
      if (requestedProvider === "fal") {
        if (!request_id) return new Response(JSON.stringify({ error: "request_id required for fal poll" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        result = await pollFalJob(request_id, model);
      } else if (requestedProvider === "veo") {
        if (!operation_name) return new Response(JSON.stringify({ error: "operation_name required for veo poll" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        result = await pollVeoOperation(operation_name);
      } else if (requestedProvider === "omni") {
        result = { status: "queued", message: "Gemini Omni Flash coming soon", provider: "omni" };
      } else {
        return new Response(JSON.stringify({ error: "unknown provider" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Generate path ────────────────────────────────────────────────────────
    if (!prompt?.trim()) {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resolvedProvider = resolveProvider(requestedProvider);
    const resolvedDuration = duration ?? 5;
    const resolvedAspect = aspect_ratio ?? "16:9";

    let result: Record<string, unknown>;

    if (resolvedProvider === "fal") {
      result = await submitFalJob(prompt.trim(), resolvedDuration, resolvedAspect, model);
    } else if (resolvedProvider === "veo") {
      result = await submitVeoJob(prompt.trim(), resolvedAspect);
    } else {
      // omni — stub for future Gemini Omni Flash capability
      result = { status: "queued", message: "Gemini Omni Flash coming soon", provider: "omni" };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("mavis-video-gen error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
