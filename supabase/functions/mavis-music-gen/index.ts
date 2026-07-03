// mavis-music-gen — AI music and audio generation
//
// Providers (all via FAL_API_KEY, no extra cost):
//   stable-audio  — Stability AI Stable Audio Open (text → music/sfx, up to 47s)
//   musicgen      — Meta MusicGen Large (text → music, up to 30s)
//
// POST body:
//   prompt       string   — describe the music ("upbeat hip hop beat, 120 BPM")
//   duration     number   — seconds (default 30, max 47 for stable-audio)
//   model        string   — "stable-audio" | "musicgen" | "auto" (default)
//   style        string   — optional style hint appended to prompt

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FAL_KEY = Deno.env.get("FAL_API_KEY") ?? "";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Stable Audio (sync call, returns fast) ────────────────────────────────────

async function generateStableAudio(prompt: string, duration: number): Promise<string> {
  const res = await fetch("https://fal.run/fal-ai/stable-audio", {
    method: "POST",
    headers: { "Authorization": `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: prompt.slice(0, 500),
      seconds_total: Math.min(duration, 47),
      steps: 100,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Stable Audio ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
  const data = await res.json();
  const url = data?.audio_file?.url ?? data?.audio?.url ?? data?.url;
  if (!url) throw new Error("Stable Audio returned no audio URL");
  return url;
}

// ── MusicGen Large (async queue job) ─────────────────────────────────────────

async function submitMusicGen(prompt: string, duration: number): Promise<{ request_id: string }> {
  const res = await fetch("https://queue.fal.run/fal-ai/musicgen-large", {
    method: "POST",
    headers: { "Authorization": `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: prompt.slice(0, 500),
      duration: Math.min(duration, 30),
      model_version: "large",
      output_format: "mp3",
      normalization_strategy: "loudness",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`MusicGen submit ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
  const data = await res.json();
  if (!data.request_id) throw new Error("MusicGen returned no request_id");
  return { request_id: data.request_id };
}

async function pollMusicGen(request_id: string): Promise<{ status: string; url?: string }> {
  const res = await fetch(`https://queue.fal.run/fal-ai/musicgen-large/${request_id}`, {
    headers: { "Authorization": `Key ${FAL_KEY}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`MusicGen poll ${res.status}`);
  const data = await res.json();
  if (data.status === "COMPLETED" || data.audio) {
    const url = data.audio?.url ?? data.output?.audio?.url ?? data.url;
    return { status: "complete", url };
  }
  if (data.status === "FAILED") throw new Error("MusicGen job failed");
  return { status: "processing" };
}

// ── Handler ──────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!FAL_KEY) return json({ error: "FAL_API_KEY not configured" }, 503);

  try {
    const body = await req.json();
    const { action, request_id, model: requestedModel } = body;

    // ── Poll path ─────────────────────────────────────────────────────────────
    if (action === "poll") {
      if (!request_id) return json({ error: "request_id required for poll" }, 400);
      const result = await pollMusicGen(String(request_id));
      return json(result);
    }

    // ── Generate path ─────────────────────────────────────────────────────────
    const rawPrompt: string = body.prompt?.trim() ?? "";
    if (!rawPrompt) return json({ error: "prompt is required" }, 400);

    const style: string = body.style?.trim() ?? "";
    const prompt = style ? `${rawPrompt}. Style: ${style}` : rawPrompt;
    const duration: number = Math.max(5, Math.min(Number(body.duration ?? 30), 47));
    const model = requestedModel ?? "stable-audio";

    if (model === "musicgen") {
      const { request_id: rid } = await submitMusicGen(prompt, duration);
      return json({ status: "processing", request_id: rid, provider: "musicgen", duration });
    }

    // stable-audio (default) — sync, returns URL directly
    const url = await generateStableAudio(prompt, duration);
    return json({ status: "complete", url, provider: "stable-audio", duration });

  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
