// mavis-media-analyst — upload reference content from HeyGen/Higgsfield/Canva,
// get a deep AI deconstruction, and a step-by-step MAVIS production blueprint.
//
// Actions:
//   create_record   — create a DB record before upload (returns id + signed upload URL)
//   analyze         — run Gemini analysis on an uploaded media item (by media_id)
//   list            — return user's media library
//   get             — return a single item with full analysis + blueprint
//   delete          — delete media record + storage file

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_KEY   = Deno.env.get("GEMINI_API_KEY") ?? "";
const OPENAI_KEY   = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const SB_URL       = Deno.env.get("SUPABASE_URL")!;
const SB_SRK       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STORAGE_BUCKET = "video-projects";   // reuse existing bucket

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Gemini File API: upload video for analysis ──────────────────────────────

async function uploadToGeminiFiles(
  videoBytes: Uint8Array,
  mimeType: string,
  displayName: string,
): Promise<string> {
  // Step 1: initiate resumable upload
  const initRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(videoBytes.length),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
    },
  );
  if (!initRes.ok) throw new Error(`Gemini Files init failed: ${initRes.status}`);
  const uploadUrl = initRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("No Gemini upload URL returned");

  // Step 2: upload bytes
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(videoBytes.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: videoBytes,
  });
  if (!uploadRes.ok) throw new Error(`Gemini Files upload failed: ${uploadRes.status}`);
  const fileData = await uploadRes.json();
  return fileData.file?.uri ?? "";
}

async function waitForGeminiFile(fileUri: string, maxWaitMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const name = fileUri.split("/").pop();
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/files/${name}?key=${GEMINI_KEY}`,
    );
    const d = await res.json();
    if (d.state === "ACTIVE") return;
    if (d.state === "FAILED") throw new Error("Gemini file processing failed");
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Gemini file processing timed out");
}

// ── Deconstruction + Blueprint prompt ──────────────────────────────────────

const SYSTEM_PROMPT = `You are a world-class video production analyst and AI tool expert.
Your job is to reverse-engineer any video or image, identify every production technique used,
determine what tools created it, and produce a precise step-by-step blueprint for recreating it
using MAVIS (an AI-powered life OS with these video tools):

MAVIS PRODUCTION TOOLS:
• mavis-heygen-agent — AI avatar talking-head videos (identical to HeyGen)
• mavis-avatar-video — ElevenLabs voice + SadTalker lip-sync (budget avatar alternative)
• mavis-video-gen — text-to-video prompt generation (fal.ai Veo3, cinematic AI video)
• mavis-video-render — FFmpeg compositing: text overlays, transitions, color grading, audio mixing
• mavis-video-editor — Gemini-powered analysis, clip extraction, segment scoring
• mavis-tts — ElevenLabs voice generation (500+ voices, multilingual)
• mavis-video-narrator — AI narration scripting + voice sync
• image-generation (DALL-E 3 / Flux) — still image and thumbnail generation

Respond ONLY with a valid JSON object matching this exact schema. No markdown, no explanation.`;

const USER_PROMPT = `Analyze this content completely and return JSON with this exact structure:
{
  "content_type": "talking_head|motion_graphic|cinematic_b_roll|social_reel|product_showcase|explainer|ad_creative|tutorial|other",
  "description": "One clear sentence describing what this is",
  "elements": [
    { "name": "element name", "description": "what it looks/sounds like", "likely_tool": "what probably made this" }
  ],
  "style_profile": {
    "aesthetic": "descriptive label",
    "color_mood": "descriptive label",
    "pacing": "slow|medium|fast",
    "format": "16:9|9:16|1:1|4:5",
    "quality_tier": "consumer|professional|broadcast"
  },
  "original_tools_detected": ["HeyGen", "Canva", ...],
  "original_cost_estimate": "e.g. $50-200/month in subscriptions",
  "production_complexity": "low|medium|high",
  "what_makes_it_effective": "2-3 sentences on why this content works",
  "blueprint": {
    "overview": "How MAVIS recreates this in 2 sentences",
    "estimated_total_time": "e.g. 45-90 minutes",
    "estimated_cost_per_video": "e.g. $1-3",
    "monthly_savings_vs_original": "e.g. Save $150/month",
    "steps": [
      {
        "step": 1,
        "title": "Step title",
        "description": "What to do and why",
        "mavis_tool": "which MAVIS tool handles this",
        "mavis_action": "the specific action/endpoint",
        "prompt_hint": "example prompt or params to use",
        "time_estimate": "e.g. 5 minutes",
        "alternatives": ["backup tool if primary fails"]
      }
    ],
    "tool_equivalents": {
      "OriginalTool": "MAVIS equivalent + how"
    },
    "pro_tips": ["specific tip to match the quality", "..."]
  }
}`;

async function analyzeWithGemini(
  fileUri: string | null,
  imageBase64: string | null,
  mimeType: string,
): Promise<unknown> {
  const parts: unknown[] = [{ text: USER_PROMPT }];

  if (fileUri) {
    parts.unshift({ file_data: { mime_type: mimeType, file_uri: fileUri } });
  } else if (imageBase64) {
    parts.unshift({ inline_data: { mime_type: mimeType, data: imageBase64 } });
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts }],
        generation_config: {
          temperature: 0.3,
          max_output_tokens: 4096,
          response_mime_type: "application/json",
        },
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!res.ok) throw new Error(`Gemini analysis failed: ${res.status} ${await res.text()}`);
  const d = await res.json();
  const raw = d.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return JSON.parse(raw);
}

// Fallback: GPT-4o Vision for images when Gemini is unavailable
async function analyzeWithOpenAI(imageBase64: string, mimeType: string): Promise<unknown> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 4096,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: USER_PROMPT },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}`, detail: "high" } },
          ],
        },
      ],
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`GPT-4o analysis failed: ${res.status}`);
  const d = await res.json();
  return JSON.parse(d.choices?.[0]?.message?.content ?? "{}");
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const sb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });

    const authHeader = req.headers.get("authorization") ?? "";
    const { data: { user } } = await sb.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const { action } = body;

    // ── create_record ────────────────────────────────────────────────────────
    if (action === "create_record") {
      const { title, media_type, mime_type, file_size_bytes, source_tool, storage_path } = body;
      if (!media_type || !storage_path) return json({ error: "media_type and storage_path required" }, 400);

      const { data: record, error: insertErr } = await sb
        .from("mavis_media_library")
        .insert({
          user_id: user.id,
          title: title ?? "Untitled",
          media_type,
          storage_path,
          mime_type: mime_type ?? "application/octet-stream",
          file_size_bytes: file_size_bytes ?? null,
          source_tool: source_tool ?? "other",
          status: "pending",
        })
        .select("id")
        .single();

      if (insertErr) return json({ error: insertErr.message }, 500);
      return json({ ok: true, id: record.id });
    }

    // ── analyze ──────────────────────────────────────────────────────────────
    if (action === "analyze") {
      const { media_id } = body;
      if (!media_id) return json({ error: "media_id required" }, 400);

      const { data: record, error: fetchErr } = await sb
        .from("mavis_media_library")
        .select("*")
        .eq("id", media_id)
        .eq("user_id", user.id)
        .single();

      if (fetchErr || !record) return json({ error: "Media not found" }, 404);

      // Mark as analyzing
      await sb.from("mavis_media_library").update({ status: "analyzing" }).eq("id", media_id);

      try {
        const mimeType: string = (record as any).mime_type ?? "video/mp4";
        const isVideo = mimeType.startsWith("video/");

        let analysis: unknown;

        if (isVideo && GEMINI_KEY) {
          // Fetch video from Supabase Storage
          const { data: signedData } = await sb.storage
            .from(STORAGE_BUCKET)
            .createSignedUrl((record as any).storage_path, 300);

          if (!signedData?.signedUrl) throw new Error("Could not get signed URL for video");

          const videoRes = await fetch(signedData.signedUrl, { signal: AbortSignal.timeout(90_000) });
          if (!videoRes.ok) throw new Error(`Failed to fetch video: ${videoRes.status}`);
          const videoBytes = new Uint8Array(await videoRes.arrayBuffer());

          const title = (record as any).title ?? "reference-media";
          const fileUri = await uploadToGeminiFiles(videoBytes, mimeType, title);
          await waitForGeminiFile(fileUri, 60_000);

          // Save file URI for potential re-use
          await sb.from("mavis_media_library").update({ gemini_file_uri: fileUri }).eq("id", media_id);

          analysis = await analyzeWithGemini(fileUri, null, mimeType);
        } else {
          // Image (or video fallback) — fetch and base64-encode
          const { data: signedData } = await sb.storage
            .from(STORAGE_BUCKET)
            .createSignedUrl((record as any).storage_path, 300);

          if (!signedData?.signedUrl) throw new Error("Could not get signed URL");

          const fileRes = await fetch(signedData.signedUrl, { signal: AbortSignal.timeout(30_000) });
          if (!fileRes.ok) throw new Error(`Failed to fetch file: ${fileRes.status}`);
          const bytes = new Uint8Array(await fileRes.arrayBuffer());
          const base64 = btoa(String.fromCharCode(...bytes));

          if (GEMINI_KEY) {
            analysis = await analyzeWithGemini(null, base64, mimeType);
          } else if (OPENAI_KEY) {
            analysis = await analyzeWithOpenAI(base64, mimeType);
          } else {
            throw new Error("No vision API key configured (GEMINI_API_KEY or OPENAI_API_KEY required)");
          }
        }

        // Separate blueprint from analysis for clean storage
        const analysisObj = analysis as Record<string, unknown>;
        const blueprint = analysisObj.blueprint ?? null;
        delete analysisObj.blueprint;

        await sb.from("mavis_media_library").update({
          analysis: analysisObj,
          blueprint,
          status: "ready",
          updated_at: new Date().toISOString(),
        }).eq("id", media_id);

        return json({ ok: true, media_id, analysis: analysisObj, blueprint });

      } catch (analyzeErr: any) {
        await sb.from("mavis_media_library").update({
          status: "error",
          error_message: analyzeErr.message,
          updated_at: new Date().toISOString(),
        }).eq("id", media_id);
        throw analyzeErr;
      }
    }

    // ── list ─────────────────────────────────────────────────────────────────
    if (action === "list") {
      const { limit = 20 } = body;
      const { data, error: listErr } = await sb
        .from("mavis_media_library")
        .select("id, title, media_type, source_tool, status, mime_type, analysis, blueprint, created_at, file_url")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (listErr) return json({ error: listErr.message }, 500);
      return json({ ok: true, items: data ?? [] });
    }

    // ── get ──────────────────────────────────────────────────────────────────
    if (action === "get") {
      const { media_id } = body;
      if (!media_id) return json({ error: "media_id required" }, 400);

      const { data, error: getErr } = await sb
        .from("mavis_media_library")
        .select("*")
        .eq("id", media_id)
        .eq("user_id", user.id)
        .single();

      if (getErr || !data) return json({ error: "Not found" }, 404);

      // Generate signed URL for preview
      const { data: signedData } = await sb.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl((data as any).storage_path, 3600);

      return json({ ok: true, item: { ...data, preview_url: signedData?.signedUrl ?? null } });
    }

    // ── delete ───────────────────────────────────────────────────────────────
    if (action === "delete") {
      const { media_id } = body;
      if (!media_id) return json({ error: "media_id required" }, 400);

      const { data: record } = await sb
        .from("mavis_media_library")
        .select("storage_path")
        .eq("id", media_id)
        .eq("user_id", user.id)
        .single();

      if (record) {
        await sb.storage.from(STORAGE_BUCKET).remove([(record as any).storage_path]);
        await sb.from("mavis_media_library").delete().eq("id", media_id);
      }

      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);

  } catch (err: any) {
    console.error("[mavis-media-analyst] error:", err.message);
    return json({ error: err.message }, 500);
  }
});
