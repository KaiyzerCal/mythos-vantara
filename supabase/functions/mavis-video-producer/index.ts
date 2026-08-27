// mavis-video-producer — turns an operator's brief into a persisted storyboard.
//
// This is stage 2 of the video pipeline (brief → storyboard → assets →
// compose → render → publish). It owns exactly one job: expanding a sentence
// like "a 45-second explainer on why the nephron filters 180L a day" into a
// beat list saved to mavis_video_productions / mavis_video_beats.
//
// It deliberately does NOT generate assets or render. Those are minutes of
// wall clock across paid providers and belong to a cron-stepped worker, the
// same shape mavis-action-processor already runs on. Storyboarding is one LLM
// call, so it can answer inline while the operator is still in the chat.
//
// Actions:
//   storyboard  — brief → beats, persisted, returns the plan
//   status      — read a production and its beats back
//   list        — recent productions for this operator
//   revise_beat — edit one beat's narration/visual/text, resetting its assets
//
// Auth: a user JWT, or the service key plus an explicit user_id (same trust
// pattern as mavis-hyperframes and mavis-youtube-ingest).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { aiComplete } from "../_shared/providers.ts";
import {
  normalizeStoryboard,
  clampTargetSeconds,
  coerceProductionType,
  coerceFormat,
  coerceVisualMode,
  suggestBeatCount,
  visualRequiredFor,
  FORMAT_DIMENSIONS,
  type ProductionType,
} from "../_shared/storyboard.ts";
import {
  type AvatarProfile,
  normalizeAvatarProfile,
  presetByKey,
  identityPromptWrapper,
  suggestProfileForBrief,
} from "../_shared/avatarProfile.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function resolveUserId(req: Request, bodyUserId?: string): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  if (token === SERVICE_KEY) return bodyUserId?.trim() || null;
  try {
    const { data } = await sb.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

/** Pull the first JSON object/array out of a model reply that may be fenced or prefaced. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.search(/[[{]/);
  if (start === -1) return null;
  const opener = body[start];
  const closer = opener === "[" ? "]" : "}";
  const end = body.lastIndexOf(closer);
  if (end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

function storyboardSystemPrompt(
  type: ProductionType,
  beatCount: number,
  seconds: number,
  profile: AvatarProfile | null = null,
): string {
  const shared =
    `You are a video director planning a ${seconds}-second short. Produce about ${beatCount} beats.\n\n` +
    `Return ONLY JSON: {"title": "...", "beats": [{"narration": "...", "visual_prompt": "...", ` +
    `"on_screen_text": "...", "seconds": 4}]}\n\n` +
    `Rules:\n` +
    `- narration is spoken aloud. Write it to be heard, not read: short sentences, plain words, no bullet syntax, no stage directions, no emoji.\n` +
    `- seconds must be realistic for the narration at roughly 150 words per minute.\n` +
    `- on_screen_text is a short caption or key phrase, 6 words maximum. Leave it empty when the visual carries the beat.\n` +
    `- Open on the strongest hook you have. Do not open with a greeting or a channel intro.\n` +
    `- The beats must add up to one continuous piece, not a list of independent facts.\n`;

  const identity = identityPromptWrapper(profile);

  if (type === "avatar") {
    return shared + identity +
      `- This is an AVATAR production: the operator's own AI presenter delivers every line to camera. ` +
      `Leave visual_prompt empty unless a beat genuinely needs cutaway B-roll over the presenter.\n` +
      `- Write narration in the operator's own first person voice.\n`;
  }
  if (type === "persona_ugc") {
    return shared + identity +
      `- This is a PERSONA UGC production: one of the operator's AI personas speaks to camera in a casual, ` +
      `handheld, creator-to-camera register — the way a real person recommends something, not the way an ad announces it.\n` +
      `- Leave visual_prompt empty unless a beat needs a product shot or cutaway.\n` +
      `- Avoid advertising cadence, superlatives, and calls to action that sound scripted.\n`;
  }
  return shared + identity +
    `- This is a FACELESS production: no presenter appears. Every beat needs a visual_prompt.\n` +
    `- visual_prompt describes ONE still frame, concretely: subject, setting, lighting, camera angle, mood. ` +
    `It is fed to an image generator, so avoid abstractions it cannot draw and never reference other beats.\n` +
    `- Keep a consistent visual register across beats so the finished piece looks like one film.\n`;
}

async function handleStoryboard(userId: string, body: Record<string, unknown>) {
  const brief = String(body.brief ?? "").trim();
  if (!brief) return json({ error: "brief is required" }, 400);

  const productionType = coerceProductionType(body.production_type);
  const format = coerceFormat(body.format);
  const visualMode = coerceVisualMode(body.visual_mode);
  const targetSeconds = clampTargetSeconds(body.target_seconds);
  const beatCount = suggestBeatCount(targetSeconds);

  // Resolve the brand identity this production is planned under.
  //
  // This runs for every production type, not just persona_ugc: a faceless piece
  // still has a house look and a subject territory, and that is exactly what
  // separates a SkyForge technical short from a Bioneer movement short.
  //
  // Order of preference, most explicit first:
  //   1. avatar_key naming a forged persona row
  //   2. avatar_key naming a built-in preset with no row yet
  //   3. a persona named by the operator
  //   4. the brief's own subject matter, if it points unambiguously at one
  const PERSONA_COLUMNS =
    "id,name,avatar_key,system_prompt,voice_id,voice_settings,voice_style," +
    "content_niche,rendering_style,overlay_style,domain_tags,asset_paths";

  let profile: AvatarProfile | null = null;
  let personaId: string | null = null;
  let personaName = "";

  const wantedKey = String(body.avatar_key ?? "").trim();
  const wantedName = String(body.persona ?? body.persona_name ?? body.avatar_name ?? "").trim();

  if (wantedKey) {
    const { data } = await sb
      .from("personas").select(PERSONA_COLUMNS)
      .eq("user_id", userId).eq("avatar_key", wantedKey).limit(1);
    const row = data?.[0] as unknown as Record<string, unknown> | undefined;
    if (row) {
      profile = normalizeAvatarProfile(row);
    } else {
      // A preset can drive a production before it has been forged into a row.
      profile = presetByKey(wantedKey);
      if (!profile) {
        return json({
          error: `Unknown avatar_key "${wantedKey}". Use a forged persona's key, ` +
                 `or one of the built-in identities: avatar_skyforge_real, avatar_bioneer_animated.`,
        }, 400);
      }
    }
  }

  if (!profile && wantedName) {
    const { data } = await sb
      .from("personas").select(PERSONA_COLUMNS)
      .eq("user_id", userId).ilike("name", `%${wantedName}%`).limit(1);
    const row = data?.[0] as unknown as Record<string, unknown> | undefined;
    if (row) profile = normalizeAvatarProfile(row);
  }

  // persona_ugc is the one type that cannot proceed without a real performer —
  // a preset is a look and a voice, not somebody's persona.
  if (productionType === "persona_ugc" && !profile?.id) {
    const { data } = await sb
      .from("personas").select(PERSONA_COLUMNS)
      .eq("user_id", userId).order("created_at", { ascending: true }).limit(1);
    const row = data?.[0] as unknown as Record<string, unknown> | undefined;
    if (!row) {
      return json({
        error: wantedName
          ? `No persona matching "${wantedName}". Ask the operator which persona should present, or list their personas first.`
          : "This operator has no personas yet — a persona_ugc production needs one. Offer to forge one, or use production_type 'faceless'.",
      }, 400);
    }
    profile = normalizeAvatarProfile(row);
  }

  // Nothing explicit — let the brief pick, but only on an unambiguous match.
  // suggestProfileForBrief returns null on a tie, so an ambiguous brief keeps
  // the neutral default rather than silently adopting a brand voice.
  if (!profile) profile = suggestProfileForBrief(brief);

  if (profile?.id) {
    personaId = profile.id;
    personaName = profile.name;
  } else if (profile) {
    personaName = profile.name;
  }

  let raw: unknown = null;
  let title = "";
  try {
    const { content } = await aiComplete({
      system: storyboardSystemPrompt(productionType, beatCount, targetSeconds, profile),
      user:
        `Brief: ${brief}\n` +
        `Format: ${format}. Target runtime: ${targetSeconds}s.` +
        (personaName ? `\nPresenter: ${personaName}.` : "") +
        (body.avatar_name ? `\nPresenter: ${String(body.avatar_name)}.` : ""),
      mode: "DEEP",
    });
    raw = extractJson(content);
    title = String((raw as { title?: unknown })?.title ?? "").trim();
  } catch (e) {
    return json({ error: `Storyboarding failed: ${(e as Error).message ?? e}` }, 502);
  }

  const plan = normalizeStoryboard(raw, {
    target_seconds: targetSeconds,
    production_type: productionType,
  });

  if (plan.beats.length === 0) {
    return json({
      error: "The storyboard came back unusable.",
      warnings: plan.warnings,
    }, 502);
  }

  const { data: production, error: pErr } = await sb
    .from("mavis_video_productions")
    .insert({
      user_id: userId,
      brief,
      title: title.slice(0, 200) || brief.slice(0, 80),
      production_type: productionType,
      format,
      visual_mode: visualMode,
      target_seconds: targetSeconds,
      persona_id: personaId,
      avatar_key: profile?.key ?? null,
      avatar_name: (body.avatar_name ? String(body.avatar_name) : profile?.name ?? "").slice(0, 120) || null,
      // An explicit voice_id from the caller wins; otherwise the identity's own
      // voice, so a Bioneer production does not narrate in SkyForge's voice.
      voice_id: (body.voice_id ? String(body.voice_id) : profile?.voice_id ?? "").slice(0, 120) || null,
      status: "storyboarded",
      warnings: plan.warnings,
    })
    .select("id,title,status,production_type,format,visual_mode,target_seconds,avatar_key")
    .single();

  if (pErr || !production) {
    return json({ error: `Could not save the production: ${pErr?.message ?? "unknown"}` }, 500);
  }

  const { error: bErr } = await sb.from("mavis_video_beats").insert(
    plan.beats.map((b) => ({
      production_id: production.id,
      user_id: userId,
      idx: b.idx,
      narration: b.narration,
      visual_prompt: b.visual_prompt,
      on_screen_text: b.on_screen_text,
      seconds: b.seconds,
      status: "pending",
    })),
  );

  if (bErr) {
    // A production with no beats is unusable and would sit in the worker's
    // queue forever — take it back out rather than leaving a broken row.
    await sb.from("mavis_video_productions").delete().eq("id", production.id);
    return json({ error: `Could not save the beats: ${bErr.message}` }, 500);
  }

  return json({
    ok: true,
    production: {
      ...production,
      persona: personaName || undefined,
      dimensions: FORMAT_DIMENSIONS[format],
      total_seconds: plan.total_seconds,
      beat_count: plan.beats.length,
      visual_required: visualRequiredFor(productionType),
    },
    beats: plan.beats,
    warnings: plan.warnings,
  });
}

async function handleStatus(userId: string, body: Record<string, unknown>) {
  const id = String(body.production_id ?? body.id ?? "").trim();
  if (!id) return json({ error: "production_id is required" }, 400);

  const { data: production } = await sb
    .from("mavis_video_productions")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!production) return json({ error: "Production not found" }, 404);

  const { data: beats } = await sb
    .from("mavis_video_beats")
    .select("idx,narration,visual_prompt,on_screen_text,seconds,status,asset_url,audio_url,error_message")
    .eq("production_id", id)
    .order("idx", { ascending: true });

  const list = beats ?? [];
  return json({
    ok: true,
    production,
    beats: list,
    progress: {
      total: list.length,
      ready: list.filter((b) => b.status === "ready").length,
      failed: list.filter((b) => b.status === "failed").length,
    },
  });
}

async function handleList(userId: string, body: Record<string, unknown>) {
  const limit = Math.min(25, Math.max(1, Number(body.limit ?? 10) || 10));
  const { data } = await sb
    .from("mavis_video_productions")
    .select("id,title,status,production_type,format,target_seconds,output_url,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return json({ ok: true, productions: data ?? [] });
}

async function handleReviseBeat(userId: string, body: Record<string, unknown>) {
  const productionId = String(body.production_id ?? "").trim();
  const idx = Number(body.idx);
  if (!productionId || !Number.isInteger(idx) || idx < 0) {
    return json({ error: "production_id and a zero-based idx are required" }, 400);
  }

  const patch: Record<string, unknown> = {};
  for (const field of ["narration", "visual_prompt", "on_screen_text"]) {
    if (typeof body[field] === "string") patch[field] = String(body[field]).trim();
  }
  if (body.seconds !== undefined) {
    const n = Number(body.seconds);
    if (Number.isFinite(n)) patch.seconds = Math.min(15, Math.max(1.5, n));
  }
  if (Object.keys(patch).length === 0) {
    return json({ error: "Nothing to change — pass narration, visual_prompt, on_screen_text or seconds." }, 400);
  }

  // Editing a beat invalidates whatever was generated for it. Clearing the
  // assets is what puts it back in front of the worker on the next tick.
  patch.status = "pending";
  patch.asset_url = null;
  patch.audio_url = null;
  patch.error_message = null;
  patch.attempts = 0;

  const { data, error } = await sb
    .from("mavis_video_beats")
    .update(patch)
    .eq("production_id", productionId)
    .eq("user_id", userId)
    .eq("idx", idx)
    .select("idx,narration,visual_prompt,on_screen_text,seconds,status")
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: `No beat ${idx} on that production` }, 404);

  // The render no longer matches the plan, so the production goes back to
  // storyboarded and the worker picks it up again.
  await sb
    .from("mavis_video_productions")
    .update({ status: "storyboarded", output_url: null, render_id: null })
    .eq("id", productionId)
    .eq("user_id", userId);

  return json({ ok: true, beat: data });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const userId = await resolveUserId(req, body.user_id as string | undefined);
  if (!userId) return json({ error: "unauthorized" }, 401);

  try {
    switch (String(body.action ?? "storyboard")) {
      case "storyboard":  return await handleStoryboard(userId, body);
      case "status":      return await handleStatus(userId, body);
      case "list":        return await handleList(userId, body);
      case "revise_beat": return await handleReviseBeat(userId, body);
      default:            return json({ error: `Unknown action "${body.action}"` }, 400);
    }
  } catch (e) {
    console.error("mavis-video-producer", e);
    return json({ error: (e as Error).message ?? "Unhandled error" }, 500);
  }
});
