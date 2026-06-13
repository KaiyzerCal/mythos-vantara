// MAVIS Video Gen (Replicate) — video generation via the Replicate API.
// Uses minimax/video-01 model with synchronous polling inside the function.
//
// NOTE: This file is the Replicate-based implementation. The primary index.ts
// uses fal.ai / Veo providers. Swap index.ts ↔ index.replicate.ts to switch
// providers, or merge both into a single multi-provider router.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Env ───────────────────────────────────────────────────────────────────────
const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN") ?? "";

// ── Types ─────────────────────────────────────────────────────────────────────
type AspectRatio = "16:9" | "9:16" | "1:1";

interface VideoGenRequest {
  prompt: string;
  duration?: number;
  aspect_ratio?: AspectRatio;
}

interface VideoGenResponse {
  url: string;
  status: string;
  duration_ms: number;
  prompt: string;
}

interface VideoGenErrorResponse {
  error: string;
  url: string;
}

// ── Replicate API helpers ─────────────────────────────────────────────────────

const REPLICATE_BASE = "https://api.replicate.com/v1";

function replicateHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${REPLICATE_API_TOKEN}`,
  };
}

/** Step 1 — Submit a prediction to Replicate and return its ID. */
async function submitPrediction(
  prompt: string,
  duration: number,
  aspect_ratio: AspectRatio,
): Promise<string> {
  const res = await fetch(`${REPLICATE_BASE}/models/minimax/video-01/predictions`, {
    method: "POST",
    headers: replicateHeaders(),
    body: JSON.stringify({
      input: { prompt, duration, aspect_ratio },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Replicate submit ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const id: string = data.id;
  if (!id) throw new Error("Replicate returned no prediction ID");
  return id;
}

/** Step 2 — Poll the prediction until it succeeds or fails. */
async function pollPrediction(
  predictionId: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const POLL_INTERVAL_MS = 3000;

  while (Date.now() < deadline) {
    const res = await fetch(`${REPLICATE_BASE}/predictions/${predictionId}`, {
      headers: replicateHeaders(),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Replicate poll ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json();

    if (data.status === "succeeded") {
      // output is an array; take first element as the video URL
      const output = data.output;
      const videoUrl: string | undefined = Array.isArray(output) ? output[0] : output;
      if (!videoUrl) throw new Error("Replicate prediction succeeded but returned no video URL");
      return videoUrl;
    }

    if (data.status === "failed" || data.status === "canceled") {
      const detail: string = data.error ?? "unknown error";
      throw new Error(`Replicate prediction ${data.status}: ${detail}`);
    }

    // Status is "starting" or "processing" — wait before next poll
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error("Video generation timed out after 120s");
}

// ── JWT auth (mirrors mavis-crew-orchestrator pattern) ────────────────────────
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";

async function getUserId(req: Request): Promise<string | null> {
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return null;

    const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
    if (jwtSecret) {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(jwtSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      );
      const signedPart = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
      const b64 = parts[2].replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      const sig = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
      const valid = await crypto.subtle.verify("HMAC", key, sig, signedPart);
      if (!valid) return null;
      const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(
        atob(payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4)),
      );
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload.sub ?? null;
    }

    // Fallback: ask Supabase to validate the token
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.4");
    const userSb = createClient(SB_URL, token, { auth: { persistSession: false } });
    const { data } = await userSb.auth.getUser();
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only accept POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Auth ────────────────────────────────────────────────────────────────────
  const userId = await getUserId(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Guard: Replicate API token ──────────────────────────────────────────────
  if (!REPLICATE_API_TOKEN) {
    return new Response(
      JSON.stringify({
        error:
          "REPLICATE_API_TOKEN is not configured. Set this secret in your Supabase project to enable video generation. " +
          "Get your token at https://replicate.com/account/api-tokens.",
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: VideoGenRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) {
    return new Response(JSON.stringify({ error: '"prompt" is required' }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Clamp duration: default 5s, max 10s
  const rawDuration = Number(body.duration ?? 5);
  const duration = Math.max(1, Math.min(10, isNaN(rawDuration) ? 5 : rawDuration));

  const validRatios: AspectRatio[] = ["16:9", "9:16", "1:1"];
  const aspect_ratio: AspectRatio =
    validRatios.includes(body.aspect_ratio as AspectRatio)
      ? (body.aspect_ratio as AspectRatio)
      : "16:9";

  const TIMEOUT_MS = 120_000; // 120 seconds max polling
  const overallStart = Date.now();

  try {
    // ── Step 1: Submit prediction ───────────────────────────────────────────
    const predictionId = await submitPrediction(prompt, duration, aspect_ratio);
    console.log(`[mavis-video-gen] Submitted prediction ${predictionId} for user ${userId}`);

    // ── Step 2: Poll until complete ─────────────────────────────────────────
    const videoUrl = await pollPrediction(predictionId, TIMEOUT_MS);
    console.log(`[mavis-video-gen] Prediction ${predictionId} succeeded: ${videoUrl}`);

    const response: VideoGenResponse = {
      url: videoUrl,
      status: "succeeded",
      duration_ms: Date.now() - overallStart,
      prompt,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-video-gen] Error:", message);

    const errorResponse: VideoGenErrorResponse = {
      error: message,
      url: "",
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
