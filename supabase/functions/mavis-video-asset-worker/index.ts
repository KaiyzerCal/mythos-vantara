// mavis-video-asset-worker — stage 3 of the video pipeline.
//
// Walks productions that have been storyboarded and fills in each beat's
// picture and voiceover, then hands the production to the composition stage.
//
// Runs on cron rather than inline because a production is minutes of wall clock
// across several paid providers — far past an edge function's budget. Each tick
// does a bounded slice of the work and returns; the next tick continues. That
// is the same shape mavis-action-processor already runs on.
//
// Every scheduling decision (what to generate, what to retry, when a production
// is finished, when to stop spending) lives in _shared/videoAssets.ts so it can
// be unit-tested. This file is the loop and the I/O around those decisions.
//
// Actions:
//   tick — cron entry; advances the oldest productions with work outstanding
//   run  — { production_id } advance one production now

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { submitVideoCascade, videoPollHandlers } from "../_shared/providers.ts";
import { FORMAT_DIMENSIONS, type VideoFormat } from "../_shared/storyboard.ts";
import {
  selectBeatsToProcess,
  nextProductionStatus,
  beatNeeds,
  beatAudioPath,
  MAX_BEAT_ATTEMPTS,
  type BeatRow,
  type ProductionRow,
} from "../_shared/videoAssets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// Wall-clock budget for one tick. Leaves room to write results back and
// respond before the platform cuts the invocation off mid-update.
const TICK_BUDGET_MS = 100_000;
// Beats attempted per production per tick. Small enough that one slow provider
// cannot consume the whole tick, large enough that a short video finishes in
// one or two passes.
const BEATS_PER_TICK = 4;
const PRODUCTIONS_PER_TICK = 2;
// Signed asset URLs must outlive composition and render comfortably.
const ASSET_URL_TTL = 60 * 60 * 24 * 30;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface ProductionFull extends ProductionRow {
  user_id: string;
  format: VideoFormat;
  voice_id: string | null;
  title: string;
}

async function generateImage(prompt: string, format: VideoFormat): Promise<string> {
  const { width, height } = FORMAT_DIMENSIONS[format];
  const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-image-gen`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({
      prompt,
      width,
      height,
      size: `${width}x${height}`,
      aspect_ratio: format,
      quality: "high",
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok || !data.url) {
    throw new Error(String(data.error ?? `image generation failed (${res.status})`));
  }
  return String(data.url);
}

/**
 * Narration is returned by mavis-tts as base64 in JSON, which cannot be handed
 * to a renderer. Persist it and give back a URL the composition can reference.
 */
async function generateNarration(
  text: string,
  voiceId: string | null,
  userId: string,
  productionId: string,
  idx: number,
): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ text, ...(voiceId ? { voice_id: voiceId } : {}) }),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok || !data.audioContent) {
    throw new Error(String(data.error ?? `narration failed (${res.status})`));
  }

  const bytes = Uint8Array.from(atob(String(data.audioContent)), (c) => c.charCodeAt(0));
  const path = beatAudioPath(userId, productionId, idx);
  const { error: upErr } = await sb.storage
    .from("vault-media")
    .upload(path, bytes, { contentType: "audio/mpeg", upsert: true });
  if (upErr) throw new Error(`could not store narration: ${upErr.message}`);

  // vault-media is private, so a public URL would 404 — sign it.
  const { data: signed } = await sb.storage
    .from("vault-media")
    .createSignedUrl(path, ASSET_URL_TTL);
  if (!signed?.signedUrl) throw new Error("could not sign narration URL");
  return signed.signedUrl;
}

/**
 * Submit or poll a per-beat video clip. Returns a URL only once ready.
 *
 * VideoGenResult's status is only "processing" | "complete" — a provider
 * failure surfaces as a thrown error, not a status, so anything that is not
 * complete is simply still running.
 *
 * The job identifier is request_id for every provider except veo, which uses
 * operation_name. Each poll handler takes its own provider's id form, so
 * storing whichever one came back and handing it straight back works for all
 * of them. fal's poll defaults to the same model its submit defaults to, so
 * the model does not need storing — but that is a coupling: if a caller ever
 * passes a non-default model to submitVideoCascade, the model must be
 * persisted alongside the job id too.
 */
async function advanceVideoBeat(
  beat: BeatRow,
  production: ProductionFull,
): Promise<{ url?: string; provider?: string; job_id?: string; pending: boolean }> {
  if (beat.provider_job_id && beat.provider) {
    const poll = videoPollHandlers[beat.provider];
    if (!poll) throw new Error(`no poll handler for provider "${beat.provider}"`);
    const r = await poll(beat.provider_job_id);
    if (r.status === "complete" && r.url) return { url: r.url, pending: false };
    return { pending: true };
  }

  const r = await submitVideoCascade({
    prompt: beat.visual_prompt,
    duration: Math.max(1, Math.round(beat.seconds)),
    aspect_ratio: production.format,
  });
  if (r.status === "complete" && r.url) return { url: r.url, pending: false };

  const jobId = r.request_id ?? r.operation_name;
  if (r.status === "processing" && jobId) {
    return { provider: r.provider, job_id: jobId, pending: true };
  }
  throw new Error("video generation returned neither a clip nor a job id");
}

/** Work one beat as far as it can go this tick. Returns paid calls made. */
async function processBeat(beat: BeatRow, production: ProductionFull): Promise<number> {
  const needs = beatNeeds(beat, production);
  const patch: Record<string, unknown> = {};
  let spent = 0;
  const problems: string[] = [];

  if (needs.visual) {
    try {
      if (production.visual_mode === "video") {
        const r = await advanceVideoBeat(beat, production);
        spent += beat.provider_job_id ? 0 : 1;
        if (r.url) {
          patch.asset_url = r.url;
          patch.provider_job_id = null;
        } else {
          if (r.provider) patch.provider = r.provider;
          if (r.job_id) patch.provider_job_id = r.job_id;
        }
      } else {
        patch.asset_url = await generateImage(beat.visual_prompt, production.format);
        spent += 1;
      }
    } catch (e) {
      problems.push(`visual: ${(e as Error).message}`);
    }
  }

  if (needs.audio) {
    try {
      patch.audio_url = await generateNarration(
        beat.narration, production.voice_id, production.user_id, production.id, beat.idx,
      );
      spent += 1;
    } catch (e) {
      problems.push(`narration: ${(e as Error).message}`);
    }
  }

  // An attempt is counted whenever real work was tried, so a persistently
  // failing beat runs out of attempts instead of retrying forever. Polling an
  // in-flight job is not an attempt — it has already been paid for.
  const isPoll = production.visual_mode === "video" && !!beat.provider_job_id && needs.visual;
  const attempts = isPoll ? beat.attempts : beat.attempts + 1;

  const merged: BeatRow = { ...beat, ...(patch as Partial<BeatRow>), attempts };
  const stillNeeds = beatNeeds(merged, production);
  const settled = !stillNeeds.visual && !stillNeeds.audio;

  patch.attempts = attempts;
  patch.error_message = problems.length ? problems.join("; ").slice(0, 500) : null;
  patch.status = settled
    ? "ready"
    : attempts >= MAX_BEAT_ATTEMPTS && problems.length
      ? "failed"
      : "generating";

  await sb.from("mavis_video_beats").update(patch).eq("id", beat.id);
  return spent;
}

async function runProduction(production: ProductionFull, deadline: number): Promise<Record<string, unknown>> {
  const { data: beatRows } = await sb
    .from("mavis_video_beats")
    .select("id,idx,narration,visual_prompt,seconds,asset_url,audio_url,provider,provider_job_id,status,attempts")
    .eq("production_id", production.id)
    .order("idx", { ascending: true });

  const beats = (beatRows ?? []) as BeatRow[];
  const queue = selectBeatsToProcess(beats, production, { limit: BEATS_PER_TICK });

  if (queue.length === 0 && beats.length > 0) {
    // Nothing actionable — either finished, out of budget, or out of attempts.
    const decision = nextProductionStatus(beats, production);
    await sb.from("mavis_video_productions")
      .update({ status: decision.status, error_message: decision.error_message })
      .eq("id", production.id);
    return { production_id: production.id, processed: 0, status: decision.status };
  }

  await sb.from("mavis_video_productions")
    .update({ status: "generating" })
    .eq("id", production.id);

  let spent = 0;
  let processed = 0;
  for (const beat of queue) {
    if (Date.now() > deadline) break;
    spent += await processBeat(beat, production);
    processed++;
  }

  if (spent > 0) {
    await sb.from("mavis_video_productions")
      .update({ generations_used: production.generations_used + spent })
      .eq("id", production.id);
  }

  // Re-read rather than reasoning from local state: processBeat has written
  // each beat individually and a concurrent revise_beat may have landed.
  const { data: after } = await sb
    .from("mavis_video_beats")
    .select("id,idx,narration,visual_prompt,seconds,asset_url,audio_url,provider,provider_job_id,status,attempts")
    .eq("production_id", production.id)
    .order("idx", { ascending: true });

  const decision = nextProductionStatus(
    (after ?? []) as BeatRow[],
    { ...production, generations_used: production.generations_used + spent },
  );
  await sb.from("mavis_video_productions")
    .update({ status: decision.status, error_message: decision.error_message })
    .eq("id", production.id);

  return {
    production_id: production.id,
    title: production.title,
    processed,
    generations: spent,
    status: decision.status,
  };
}

const PRODUCTION_COLUMNS =
  "id,user_id,title,production_type,visual_mode,format,voice_id,generation_budget,generations_used";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Service-role only: this spends money, so it is not reachable with a user
  // JWT. Operators drive it through MAVIS, which calls with the service key.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (token !== SERVICE_KEY) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const deadline = Date.now() + TICK_BUDGET_MS;

  try {
    if (body.action === "run") {
      const id = String(body.production_id ?? "").trim();
      if (!id) return json({ error: "production_id is required" }, 400);
      const { data } = await sb
        .from("mavis_video_productions").select(PRODUCTION_COLUMNS).eq("id", id).maybeSingle();
      if (!data) return json({ error: "Production not found" }, 404);
      return json({ ok: true, results: [await runProduction(data as ProductionFull, deadline)] });
    }

    const { data: due } = await sb
      .from("mavis_video_productions")
      .select(PRODUCTION_COLUMNS)
      .in("status", ["storyboarded", "generating"])
      .order("updated_at", { ascending: true })
      .limit(PRODUCTIONS_PER_TICK);

    const results: Record<string, unknown>[] = [];
    for (const production of (due ?? []) as ProductionFull[]) {
      if (Date.now() > deadline) break;
      results.push(await runProduction(production, deadline));
    }
    return json({ ok: true, examined: due?.length ?? 0, results });
  } catch (e) {
    console.error("mavis-video-asset-worker", e);
    return json({ error: (e as Error).message ?? "Unhandled error" }, 500);
  }
});
