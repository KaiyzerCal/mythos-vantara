// mavis-video-narrator
// Frame-by-frame Claude vision → coherent voiceover script → OpenAI TTS → Telegram audio + Google Drive MP3.
// Mirrors n8n: Download video → Python/OpenCV (90 frames, evenly distributed) →
//   Loop batches of 15 frames → GPT-4o vision "Continue from script…" → Combine → TTS → Google Drive.
//
// Actions:
//   narrate_frames — provide frame_urls[] or frames_base64[]; full narration pipeline
//   narrate_video  — provide video_url; ffmpeg frame extraction then narrates (requires ffmpeg in env)
//
// Requires:
//   ANTHROPIC_API_KEY — Claude vision (claude-sonnet-4-6 recommended for image quality)
//   OPENAI_API_KEY    — TTS synthesis (tts-1, mp3)
//   TELEGRAM_BOT_TOKEN + TELEGRAM_OPERATOR_CHAT_ID — audio delivery
//   mavis_user_integrations provider='google' + GOOGLE_CLIENT_ID/SECRET — optional GDrive upload

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_SRK        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_KEY    = Deno.env.get("OPENAI_API_KEY") ?? "";
const BOT_TOKEN     = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const OPERATOR_CHAT = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";
const GOOGLE_ID     = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const GOOGLE_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";

// ── Google OAuth token ────────────────────────────────────────────────────────

async function refreshGoogleToken(cfg: Record<string, unknown>, sb: ReturnType<typeof createClient>, uid: string): Promise<string> {
  if (!GOOGLE_ID || !GOOGLE_SECRET) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     GOOGLE_ID,
      client_secret: GOOGLE_SECRET,
      refresh_token: String(cfg.refresh_token ?? ""),
      grant_type:    "refresh_token",
    }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google token refresh failed: ${data.error_description ?? data.error}`);
  const token     = String(data.access_token);
  const expiresAt = Date.now() + (Number(data.expires_in ?? 3600) - 60) * 1000;
  await sb.from("mavis_user_integrations").upsert(
    { user_id: uid, provider: "google", config: { ...cfg, access_token: token, expires_at: expiresAt } },
    { onConflict: "user_id,provider" },
  );
  return token;
}

async function getGoogleToken(sb: ReturnType<typeof createClient>, uid: string): Promise<string | null> {
  const { data } = await sb.from("mavis_user_integrations")
    .select("config").eq("user_id", uid).eq("provider", "google").single();
  if (!data) return null;
  const cfg = data.config as Record<string, unknown>;
  if (Number(cfg.expires_at ?? 0) > Date.now()) return String(cfg.access_token ?? "");
  return refreshGoogleToken(cfg, sb, uid);
}

// ── Claude vision — single batch ─────────────────────────────────────────────

type FrameInput = { type: "url"; url: string } | { type: "base64"; data: string };

async function narrateBatch(frames: FrameInput[], previousScript: string, persona: string, model: string): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

  const images = frames.map(f =>
    f.type === "url"
      ? { type: "image", source: { type: "url", url: f.url } }
      : { type: "image", source: { type: "base64", media_type: "image/jpeg", data: f.data } }
  );

  const prompt =
    `These are frames from a video. Create a short voiceover script in the style of ${persona}. Only include the narration.` +
    (previousScript ? `\n\nContinue from this script:\n${previousScript}` : "");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content: [...images, { type: "text", text: prompt }] }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Claude vision error: ${JSON.stringify(data?.error).slice(0, 200)}`);
  return (data.content?.[0]?.text ?? "").trim();
}

// ── Core narration pipeline ───────────────────────────────────────────────────

interface NarrationConfig {
  persona: string;
  voice: string;
  model: string;
  batchSize: number;
  batchDelayMs: number;
  chatId: string;
  folderId: string;
  filename: string;
}

async function runNarration(
  frames: FrameInput[],
  cfg: NarrationConfig,
  sb: ReturnType<typeof createClient>,
  uid: string,
): Promise<Record<string, unknown>> {
  const { persona, voice, model, batchSize, batchDelayMs, chatId, folderId, filename } = cfg;

  // Build batches
  const batches: FrameInput[][] = [];
  for (let i = 0; i < frames.length; i += batchSize) batches.push(frames.slice(i, i + batchSize));

  // Batched vision with "Continue from script" continuity — mirrors n8n loop node
  const scriptParts: string[] = [];
  for (let i = 0; i < batches.length; i++) {
    const part = await narrateBatch(batches[i], scriptParts.join("\n"), persona, model);
    scriptParts.push(part);
    if (batchDelayMs > 0 && i < batches.length - 1) await new Promise(r => setTimeout(r, batchDelayMs));
  }

  const fullScript = scriptParts.join("\n");
  const results: Record<string, unknown> = {
    script:       fullScript,
    script_parts: scriptParts.length,
    frames_used:  frames.length,
    batches:      batches.length,
    persona,
  };

  if (!OPENAI_KEY) {
    results.audio_error = "OPENAI_API_KEY not configured";
    return results;
  }

  // TTS
  const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
    body:    JSON.stringify({ model: "tts-1", input: fullScript, voice, response_format: "mp3" }),
    signal:  AbortSignal.timeout(60000),
  });

  if (!ttsRes.ok) {
    results.audio_error = `TTS failed: HTTP ${ttsRes.status}`;
    return results;
  }

  const audioBuffer = await ttsRes.arrayBuffer();
  results.audio_bytes = audioBuffer.byteLength;

  // Telegram delivery
  if (BOT_TOKEN && chatId) {
    const caption = `🎙️ ${filename.replace(/\.mp3$/i, "")}\n\n${fullScript.slice(0, 200)}…`;
    const form    = new FormData();
    form.append("chat_id", chatId);
    form.append("audio", new Blob([audioBuffer], { type: "audio/mpeg" }), filename);
    form.append("caption", caption.slice(0, 1024));
    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendAudio`, {
      method: "POST", body: form, signal: AbortSignal.timeout(60000),
    }).catch(() => null);
    results.telegram_sent = tgRes?.ok ?? false;
  }

  // Google Drive upload (optional)
  if (folderId) {
    const gToken = await getGoogleToken(sb, uid).catch(() => null);
    if (gToken) {
      const meta     = JSON.stringify({ name: filename, parents: [folderId] });
      const boundary = `mavis_${Date.now()}`;
      const enc      = new TextEncoder();
      const start    = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: audio/mpeg\r\n\r\n`);
      const end      = enc.encode(`\r\n--${boundary}--`);
      const audio    = new Uint8Array(audioBuffer);
      const body     = new Uint8Array(start.length + audio.length + end.length);
      body.set(start, 0);
      body.set(audio, start.length);
      body.set(end, start.length + audio.length);

      const driveRes = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
        {
          method:  "POST",
          headers: { "Authorization": `Bearer ${gToken}`, "Content-Type": `multipart/related; boundary=${boundary}` },
          body,
          signal: AbortSignal.timeout(60000),
        },
      ).catch(() => null);

      if (driveRes?.ok) {
        const d = await driveRes.json().catch(() => ({}));
        results.gdrive_url = d.webViewLink ?? `https://drive.google.com/file/d/${d.id}/view`;
      } else {
        results.gdrive_error = `Drive upload failed: HTTP ${driveRes?.status}`;
      }
    } else {
      results.gdrive_error = "Google OAuth not configured (add to mavis_user_integrations provider='google')";
    }
  }

  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body       = await req.json().catch(() => ({}));
    const adminSb    = createClient(SB_URL, SB_SRK);
    const authHeader = req.headers.get("Authorization") ?? "";

    let uid: string;
    if (authHeader === `Bearer ${SB_SRK}`) {
      uid = String(body.userId ?? body.user_id ?? "").trim();
      if (!uid) return json({ error: "userId required for service-role calls" }, 400);
    } else if (authHeader.startsWith("Bearer ")) {
      const { data: { user }, error } = await adminSb.auth.getUser(authHeader.replace("Bearer ", ""));
      if (error || !user) return json({ error: "Unauthorized" }, 401);
      uid = user.id;
    } else {
      return json({ error: "Unauthorized" }, 401);
    }

    const action = String(body.action ?? "narrate_frames");

    const narrationCfg: NarrationConfig = {
      persona:      String(body.persona    ?? "David Attenborough"),
      voice:        String(body.voice      ?? "onyx"),   // onyx is closest to Attenborough's deep timbre
      model:        String(body.model      ?? "claude-sonnet-4-6"),
      batchSize:    Math.min(Math.max(Number(body.batch_size    ?? 15), 1), 20),
      batchDelayMs: Math.min(Number(body.batch_delay_ms ?? 1000), 10000),
      chatId:       String(body.telegram_chat_id ?? OPERATOR_CHAT),
      folderId:     String(body.gdrive_folder_id ?? ""),
      filename:     String(body.filename ?? `narration-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-")}.mp3`),
    };
    const maxFrames = Math.min(Number(body.max_frames ?? 90), 200);

    switch (action) {

      case "narrate_frames": {
        // Pre-extracted frames: accepts frame_urls[] (public image URLs) or frames_base64[] (JPEG base64 strings)
        const frameUrls:    string[] = Array.isArray(body.frame_urls)    ? body.frame_urls    : [];
        const framesBase64: string[] = Array.isArray(body.frames_base64) ? body.frames_base64 : [];

        if (!frameUrls.length && !framesBase64.length) {
          return json({ error: "narrate_frames requires frame_urls[] or frames_base64[]" }, 400);
        }

        // Normalise and cap
        const all: FrameInput[] = [
          ...frameUrls.map(url => ({ type: "url" as const, url })),
          ...framesBase64.map(data => ({ type: "base64" as const, data })),
        ];

        // Evenly distribute down to maxFrames if needed
        const frames: FrameInput[] = all.length <= maxFrames
          ? all
          : Array.from({ length: maxFrames }, (_, i) => all[Math.floor(i * (all.length / maxFrames))]);

        const results = await runNarration(frames, narrationCfg, adminSb, uid);

        await adminSb.from("mavis_memory").insert({
          user_id:    uid,
          role:       "assistant",
          content:    `[VIDEO NARRATOR] Narrated ${frames.length} frames. Script: ${String(results.script ?? "").slice(0, 200)}`,
          tags:       ["video_narrator", "narration", "tts", "vision"],
          importance: 4,
        }).catch(() => {});

        return json(results);
      }

      case "narrate_video": {
        // Download video → ffmpeg frame extraction → runNarration.
        // Requires ffmpeg to be available in the edge function runtime.
        const videoUrl = String(body.video_url ?? body.url ?? "");
        if (!videoUrl) return json({ error: "narrate_video requires video_url" }, 400);

        // Download video
        const videoRes = await fetch(videoUrl, {
          headers: { "User-Agent": "Mozilla/5.0 MAVIS/1.0" },
          signal:  AbortSignal.timeout(120000),
        });
        if (!videoRes.ok) throw new Error(`Failed to download video: HTTP ${videoRes.status} — ${videoUrl.slice(0, 80)}`);
        const videoBytes = new Uint8Array(await videoRes.arrayBuffer());

        const tmpVideo  = `/tmp/mavis_vid_${Date.now()}.mp4`;
        const tmpFrames = `/tmp/mavis_frm_${Date.now()}`;
        await Deno.writeFile(tmpVideo, videoBytes);
        await Deno.mkdir(tmpFrames, { recursive: true });

        const fps = Number(body.fps ?? 0.5);   // default: 1 frame every 2 sec

        // ffmpeg: extract up to maxFrames frames at fps rate, JPEG quality 3
        let frameFiles: string[] = [];
        try {
          const cmd    = new Deno.Command("ffmpeg", {
            args: ["-i", tmpVideo, "-vf", `fps=${fps}`, "-vframes", String(maxFrames), "-q:v", "3", `${tmpFrames}/frame_%04d.jpg`, "-y"],
            stdout: "piped",
            stderr: "piped",
          });
          const { success, stderr } = await cmd.output();
          if (!success) {
            const msg = new TextDecoder().decode(stderr).slice(-300);
            throw new Error(`ffmpeg exited non-zero: ${msg}`);
          }
          for await (const e of Deno.readDir(tmpFrames)) {
            if (e.name.endsWith(".jpg")) frameFiles.push(`${tmpFrames}/${e.name}`);
          }
          frameFiles.sort();
        } catch (ffErr) {
          await Deno.remove(tmpVideo).catch(() => {});
          await Deno.remove(tmpFrames, { recursive: true }).catch(() => {});
          return json({
            error: ffErr instanceof Error ? ffErr.message : String(ffErr),
            hint:  "ffmpeg must be present in the runtime. Alternatively extract frames upstream and call narrate_frames with frame_urls[].",
          }, 503);
        }

        // Read frames → base64
        const frames: FrameInput[] = [];
        for (const f of frameFiles.slice(0, maxFrames)) {
          const bytes = await Deno.readFile(f);
          frames.push({ type: "base64", data: btoa(String.fromCharCode(...bytes)) });
        }

        // Clean up temp files
        await Deno.remove(tmpVideo).catch(() => {});
        await Deno.remove(tmpFrames, { recursive: true }).catch(() => {});

        if (!frames.length) return json({ error: "No frames extracted from video" }, 500);

        const results = await runNarration(frames, narrationCfg, adminSb, uid);
        results.frames_extracted = frames.length;
        results.source_url       = videoUrl;

        await adminSb.from("mavis_memory").insert({
          user_id:    uid,
          role:       "assistant",
          content:    `[VIDEO NARRATOR] Narrated video (${frames.length} frames). Script: ${String(results.script ?? "").slice(0, 150)}`,
          tags:       ["video_narrator", "narration", "tts", "vision", "video"],
          importance: 4,
        }).catch(() => {});

        return json(results);
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: narrate_frames | narrate_video`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-video-narrator]", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
