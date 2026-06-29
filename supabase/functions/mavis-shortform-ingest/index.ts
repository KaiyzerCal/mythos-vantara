// mavis-shortform-ingest — Transcribe short-form video (TikTok, Instagram Reels, Twitter/X)
// using tikwm.com for video download URL + OpenAI Whisper for transcription.
//
// POST { url: string, save_as?: "note"|"vault", _preview?: boolean }
// Returns { title, summary, transcript, platform, chunks_created }
//
// Required env vars:
//   OPENAI_API / OPENAI_API_KEY  — Whisper + embeddings
//   ANTHROPIC_API_KEY            — Claude summary
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_KEY   = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function resolveUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  // Accept service role key directly (used by Telegram bot)
  if (token === SERVICE_KEY) return "service";
  try {
    const { data } = await adminSb.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ── Platform detection ────────────────────────────────────────────────────────

type Platform = "tiktok" | "instagram" | "twitter" | "unknown";

function detectPlatform(url: string): Platform {
  if (/tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com/i.test(url)) return "tiktok";
  if (/instagram\.com\/(reel|p)\//i.test(url)) return "instagram";
  if (/twitter\.com|x\.com/i.test(url)) return "twitter";
  return "unknown";
}

// ── Video URL resolution via tikwm.com ───────────────────────────────────────
// tikwm supports TikTok and Instagram Reels with no API key.
// Returns { videoUrl, title } or throws.

interface TikwmResult {
  videoUrl: string;
  title: string;
  duration: number;
}

async function resolveViaTikwm(url: string): Promise<TikwmResult> {
  const endpoint = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
  const res = await fetch(endpoint, {
    headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.tikwm.com/" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`tikwm API error: ${res.status}`);
  const data = await res.json();
  if (data.code !== 0 || !data.data) throw new Error(data.msg ?? "tikwm returned no data");
  const d = data.data;
  // play = watermark-free mp4; wmplay fallback
  const videoUrl = d.play ?? d.wmplay ?? d.hdplay;
  if (!videoUrl) throw new Error("tikwm: no playable URL in response");
  return {
    videoUrl,
    title: d.title ?? d.desc ?? "Short-form video",
    duration: d.duration ?? 0,
  };
}

// ── Download video as ArrayBuffer (max 24 MB for Whisper) ────────────────────

const MAX_VIDEO_BYTES = 24 * 1024 * 1024; // 24 MB

async function downloadVideo(videoUrl: string): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  const res = await fetch(videoUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(40000),
  });
  if (!res.ok) throw new Error(`Video download failed: ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "video/mp4";
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_VIDEO_BYTES) {
    throw new Error(`Video too large for Whisper (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB > 24 MB)`);
  }
  return { buffer, contentType };
}

// ── OpenAI Whisper transcription ─────────────────────────────────────────────

async function transcribeWithWhisper(buffer: ArrayBuffer, contentType: string, filename = "video.mp4"): Promise<string> {
  if (!OPENAI_KEY) throw new Error("OPENAI_API key not configured");
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: contentType }), filename);
  form.append("model", "whisper-1");
  form.append("response_format", "text");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whisper error ${res.status}: ${err.slice(0, 200)}`);
  }
  return (await res.text()).trim();
}

// ── Claude summary ────────────────────────────────────────────────────────────

async function summariseTranscript(transcript: string, platform: Platform): Promise<string> {
  if (!ANTHROPIC_KEY) return "";
  const platformLabel = platform === "tiktok" ? "TikTok" : platform === "instagram" ? "Instagram Reel" : "video";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: `You are a concise research assistant. Summarize ${platformLabel} video transcripts clearly and helpfully.`,
      messages: [{
        role: "user",
        content: `This is a transcript from a ${platformLabel} video. Summarize the key points in 3-5 bullets, then write a short 2-paragraph summary.\n\nTranscript:\n${transcript.slice(0, 10000)}`,
      }],
    }),
  });
  if (!res.ok) return "";
  const data = await res.json();
  return data.content?.[0]?.text?.trim() ?? "";
}

// ── OpenAI embedding ──────────────────────────────────────────────────────────

async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!OPENAI_KEY) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.[0]?.embedding ?? null;
  } catch { return null; }
}

// ── Chunking ──────────────────────────────────────────────────────────────────

function chunkText(text: string, chunkSize = 1000, overlap = 100, maxChunks = 20): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length && chunks.length < maxChunks) {
    chunks.push(text.slice(i, i + chunkSize).trim());
    i += chunkSize - overlap;
  }
  return chunks.filter((c) => c.length > 0);
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const userId = await resolveUserId(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  let body: { url?: string; save_as?: string; _preview?: boolean };
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }

  const url = String(body.url ?? "").trim();
  if (!url) return json({ error: "url is required" }, 400);

  const platform = detectPlatform(url);
  if (platform === "unknown") {
    return json({ error: "Unsupported platform. Supported: TikTok, Instagram Reels, Twitter/X." }, 400);
  }

  const preview = body._preview === true;
  const saveAs: "note" | "vault" = body.save_as === "vault" ? "vault" : "note";

  // 1. Get video download URL
  let videoUrl: string;
  let title: string;
  try {
    const result = await resolveViaTikwm(url);
    videoUrl = result.videoUrl;
    title = result.title;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[mavis-shortform-ingest] URL resolution failed:", msg);
    return json({ error: `Could not resolve video URL: ${msg}` }, 422);
  }

  // 2. Download video
  let buffer: ArrayBuffer;
  let contentType: string;
  try {
    ({ buffer, contentType } = await downloadVideo(videoUrl));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: `Video download failed: ${msg}` }, 422);
  }

  // 3. Transcribe with Whisper
  let transcript: string;
  try {
    transcript = await transcribeWithWhisper(buffer, contentType, `${platform}.mp4`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: `Transcription failed: ${msg}` }, 500);
  }

  if (!transcript) return json({ error: "Whisper returned empty transcript" }, 500);

  // 4. Summarise with Claude
  let summary = "";
  try {
    summary = await summariseTranscript(transcript, platform);
  } catch { /* non-fatal */ }

  // Preview mode: return without saving to notes
  if (preview) {
    return json({ title, summary, transcript, platform, chunks_created: 0 });
  }

  // 5. Save to mavis_notes
  const chunks = chunkText(transcript, 1000, 100, 20);
  const noteIds: string[] = [];
  const platformLabel = platform === "tiktok" ? "TikTok" : platform === "instagram" ? "Instagram Reel" : "Twitter/X";

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await generateEmbedding(chunks[i]);
    const noteRecord: Record<string, unknown> = {
      user_id: userId === "service" ? null : userId,
      title: `[${platformLabel}] ${title} — chunk ${i + 1}/${chunks.length}`,
      content: chunks[i],
      tags: [platform, "transcript", "short-form", "auto-extracted"],
      aliases: [],
      properties: {
        url,
        platform,
        summary: i === 0 ? summary : undefined,
        chunk_index: i,
        total_chunks: chunks.length,
        skip_sr: true,
      },
    };
    if (embedding) noteRecord.embedding = embedding;

    const { data: inserted, error: insertErr } = await adminSb
      .from("mavis_notes")
      .insert(noteRecord)
      .select("id")
      .single();

    if (insertErr) console.error(`[mavis-shortform-ingest] Insert chunk ${i} error:`, insertErr);
    else if (inserted?.id) noteIds.push(inserted.id);
  }

  return json({ title, summary, transcript, platform, chunks_created: noteIds.length, save_as: saveAs });
});
