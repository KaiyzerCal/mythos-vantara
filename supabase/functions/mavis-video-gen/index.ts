import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FAL_KEY    = Deno.env.get("FAL_API_KEY")    ?? Deno.env.get("FAL_AI_API_KEY") ?? "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const MODELSLAB_KEY = Deno.env.get("MODELSLAB_API_KEY") ?? "";

type AspectRatio = "16:9" | "9:16" | "1:1";
type Provider = "fal" | "veo" | "omni" | "kling" | "runway" | "modelslab" | "auto";

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
  if (!FAL_KEY) throw new Error("FAL_API_KEY or FAL_AI_API_KEY is required for fal.ai video generation");
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

// ── Kling AI 2.1 (cinematic, Higgsfield-competitive) ─────────────────────────

async function submitKlingJob(
  prompt: string,
  duration: number,
  aspect_ratio: AspectRatio,
): Promise<{ status: string; request_id: string; provider: string }> {
  if (!FAL_KEY) throw new Error("FAL_API_KEY or FAL_AI_API_KEY is required for Kling video generation");
  const endpoint = "https://queue.fal.run/fal-ai/kling-video/v2.1/standard/text-to-video";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Authorization": `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: prompt.slice(0, 2500),
      duration: String(Math.min(duration, 10)),
      aspect_ratio,
      negative_prompt: "blurry, low quality, watermark, text overlay, distorted",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Kling submit ${res.status}: ${await res.text().then(t => t.slice(0, 300))}`);
  const data = await res.json();
  if (!data.request_id) throw new Error("Kling returned no request_id");
  return { status: "processing", request_id: data.request_id, provider: "kling" };
}

async function pollKlingJob(request_id: string): Promise<{ status: string; url?: string; provider: string }> {
  const res = await fetch(
    `https://queue.fal.run/fal-ai/kling-video/v2.1/standard/text-to-video/${request_id}`,
    { headers: { "Authorization": `Key ${FAL_KEY}` }, signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw new Error(`Kling poll ${res.status}`);
  const data = await res.json();
  if (data.status === "COMPLETED" || data.video?.url) {
    const url = data.video?.url ?? data.output?.video?.url;
    if (!url) throw new Error("Kling complete but no video URL");
    return { status: "complete", url, provider: "kling" };
  }
  if (data.status === "FAILED") throw new Error(`Kling job failed: ${data.error ?? "unknown"}`);
  return { status: "processing", provider: "kling" };
}

// ── Runway Gen-4 Turbo (cinematic controls, via fal.ai) ──────────────────────

const RUNWAY_RATIO_MAP: Record<string, string> = {
  "16:9": "1280:720",
  "9:16": "720:1280",
  "1:1":  "960:960",
};

async function submitRunwayJob(
  prompt: string,
  aspect_ratio: AspectRatio,
  image_url?: string,
): Promise<{ status: string; request_id: string; provider: string }> {
  if (!FAL_KEY) throw new Error("FAL_API_KEY or FAL_AI_API_KEY is required for Runway video generation");
  const res = await fetch("https://queue.fal.run/fal-ai/runway-gen4-turbo", {
    method: "POST",
    headers: { "Authorization": `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: prompt.slice(0, 1000),
      ratio: RUNWAY_RATIO_MAP[aspect_ratio] ?? "1280:720",
      ...(image_url ? { image_url } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Runway submit ${res.status}: ${await res.text().then(t => t.slice(0, 300))}`);
  const data = await res.json();
  if (!data.request_id) throw new Error("Runway returned no request_id");
  return { status: "processing", request_id: data.request_id, provider: "runway" };
}

async function pollRunwayJob(request_id: string): Promise<{ status: string; url?: string; provider: string }> {
  const res = await fetch(
    `https://queue.fal.run/fal-ai/runway-gen4-turbo/${request_id}`,
    { headers: { "Authorization": `Key ${FAL_KEY}` }, signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw new Error(`Runway poll ${res.status}`);
  const data = await res.json();
  if (data.status === "COMPLETED" || data.video?.url) {
    const url = data.video?.url ?? data.output?.url;
    if (!url) throw new Error("Runway complete but no video URL");
    return { status: "complete", url, provider: "runway" };
  }
  if (data.status === "FAILED") throw new Error(`Runway job failed: ${data.error ?? "unknown"}`);
  return { status: "processing", provider: "runway" };
}

// ── ModelsLab video (text-to-video, uncensored-capable) ─────────────────────

async function submitModelsLabJob(
  prompt: string,
  duration: number,
  aspect_ratio: AspectRatio,
): Promise<{ status: string; request_id?: string; url?: string; provider: string }> {
  if (!MODELSLAB_KEY) throw new Error("MODELSLAB_API_KEY is required for ModelsLab video generation");
  const ratioMap: Record<AspectRatio, [number, number]> = {
    "16:9": [1024, 576],
    "9:16": [576, 1024],
    "1:1":  [768, 768],
  };
  const [width, height] = ratioMap[aspect_ratio] ?? [1024, 576];
  const res = await fetch("https://modelslab.com/api/v6/video/text2video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: MODELSLAB_KEY,
      prompt: prompt.slice(0, 2000),
      negative_prompt: "blurry, low quality, watermark, distorted",
      width, height,
      num_frames: Math.min(Math.max(duration * 8, 16), 64),
      num_inference_steps: 20,
      guidance_scale: 7,
      output_type: "mp4",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`ModelsLab submit ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  if (data?.status === "success") {
    const url = Array.isArray(data.output) ? data.output[0] : data.output;
    return { status: "complete", url, provider: "modelslab" };
  }
  if (data?.status === "processing") {
    return { status: "processing", request_id: String(data.id ?? data.fetch_result ?? ""), provider: "modelslab" };
  }
  throw new Error(`ModelsLab error: ${data?.message ?? JSON.stringify(data).slice(0, 200)}`);
}

async function pollModelsLabJob(request_id: string): Promise<{ status: string; url?: string; provider: string }> {
  const fetchUrl = request_id.startsWith("http")
    ? request_id
    : `https://modelslab.com/api/v6/video/fetch/${request_id}`;
  const res = await fetch(fetchUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: MODELSLAB_KEY }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ModelsLab poll ${res.status}`);
  const data = await res.json();
  if (data?.status === "success") {
    const url = Array.isArray(data.output) ? data.output[0] : data.output;
    return { status: "complete", url, provider: "modelslab" };
  }
  if (data?.status === "processing") return { status: "processing", provider: "modelslab" };
  throw new Error(`ModelsLab failed: ${data?.message ?? "unknown"}`);
}


// ── Veo 3.1 via Gemini API ──────────────────────────────────────────────────

async function submitVeoJob(
  prompt: string,
  aspect_ratio: AspectRatio
): Promise<{ status: string; operation_name: string; provider: string }> {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY is required for Veo video generation");
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

function resolveProvider(requested?: Provider): "fal" | "veo" | "omni" | "kling" | "runway" | "modelslab" {
  if (requested && requested !== "auto") return requested as "fal" | "veo" | "omni" | "kling" | "runway" | "modelslab";
  if (FAL_KEY) return "fal";
  if (MODELSLAB_KEY) return "modelslab";
  if (GEMINI_KEY) return "veo";
  throw new Error("No video generation API key configured (FAL_API_KEY, MODELSLAB_API_KEY, or GEMINI_API_KEY required)");
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
      } else if (requestedProvider === "kling") {
        if (!request_id) return new Response(JSON.stringify({ error: "request_id required for kling poll" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        result = await pollKlingJob(request_id);
      } else if (requestedProvider === "runway") {
        if (!request_id) return new Response(JSON.stringify({ error: "request_id required for runway poll" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        result = await pollRunwayJob(request_id);
      } else if (requestedProvider === "veo") {
        if (!operation_name) return new Response(JSON.stringify({ error: "operation_name required for veo poll" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        result = await pollVeoOperation(operation_name);
      } else if (requestedProvider === "modelslab") {
        if (!request_id) return new Response(JSON.stringify({ error: "request_id required for modelslab poll" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        result = await pollModelsLabJob(request_id);
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

    if (resolvedProvider === "kling") {
      result = await submitKlingJob(prompt.trim(), resolvedDuration, resolvedAspect);
    } else if (resolvedProvider === "runway") {
      result = await submitRunwayJob(prompt.trim(), resolvedAspect, body.image_url as string | undefined);
    } else if (resolvedProvider === "fal") {
      result = await submitFalJob(prompt.trim(), resolvedDuration, resolvedAspect, model);
    } else if (resolvedProvider === "modelslab") {
      result = await submitModelsLabJob(prompt.trim(), resolvedDuration, resolvedAspect);
    } else if (resolvedProvider === "veo") {
      result = await submitVeoJob(prompt.trim(), resolvedAspect);
    } else {
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
