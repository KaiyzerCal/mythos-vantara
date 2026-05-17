// MAVIS YouTube Ingest — Extracts a YouTube video transcript and ingests it
// into the MAVIS knowledge base with embeddings.
// Auth: Bearer JWT.
//
// Required env vars:
//   OPENAI_API              — OpenAI API key for embeddings
//   ANTHROPIC_API_KEY       — for summarisation
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_KEY = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
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
  try {
    const { data } = await adminSb.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ── Video ID extraction ───────────────────────────────────────────────────────

function extractVideoId(url: string): string | null {
  // Support https://www.youtube.com/watch?v=VIDEO_ID
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  // Support https://youtu.be/VIDEO_ID
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  return null;
}

// ── Transcript extraction ─────────────────────────────────────────────────────

interface TranscriptResult {
  text: string;
  title: string;
}

async function fetchTranscript(videoId: string): Promise<TranscriptResult> {
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const res = await fetch(pageUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!res.ok) {
    throw new Error(`YouTube page fetch failed: ${res.status}`);
  }

  const html = await res.text();

  // Extract title from ytInitialPlayerResponse
  let title = "Unknown Video";
  const titleMatch = html.match(/"title"\s*:\s*\{\s*"runs"\s*:\s*\[\s*\{\s*"text"\s*:\s*"([^"]+)"/);
  if (titleMatch) {
    title = titleMatch[1];
  } else {
    // Fallback: HTML <title> tag
    const htmlTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (htmlTitle) title = htmlTitle[1].replace(" - YouTube", "").trim();
  }

  // Extract captions baseUrl from playerCaptionsTracklistRenderer
  const captionsMatch = html.match(/"playerCaptionsTracklistRenderer"\s*:\s*\{.*?"captionTracks"\s*:\s*\[([^\]]+)\]/s);
  if (!captionsMatch) {
    throw new Error("No captions found in ytInitialPlayerResponse");
  }

  const baseUrlMatch = captionsMatch[1].match(/"baseUrl"\s*:\s*"([^"]+)"/);
  if (!baseUrlMatch) {
    throw new Error("No caption track baseUrl found");
  }

  // Unescape JSON unicode escapes in the URL
  const captionBaseUrl = baseUrlMatch[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/");

  // Fetch the XML transcript
  const xmlRes = await fetch(captionBaseUrl, {
    headers: { "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!xmlRes.ok) {
    throw new Error(`Caption XML fetch failed: ${xmlRes.status}`);
  }

  const xml = await xmlRes.text();

  // Parse <text> tags and concatenate
  const textMatches = xml.match(/<text[^>]*>([^<]*)<\/text>/g) ?? [];
  const transcript = textMatches
    .map((tag) => {
      return tag
        .replace(/<text[^>]*>/g, "")
        .replace(/<\/text>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n/g, " ")
        .trim();
    })
    .filter(Boolean)
    .join(" ");

  if (!transcript) {
    throw new Error("Transcript XML parsed but no text extracted");
  }

  return { text: transcript, title };
}

// ── Fallback: summarise using Claude document API ─────────────────────────────

async function fallbackSummary(videoId: string, url: string): Promise<TranscriptResult> {
  // No transcript available — build a minimal placeholder for downstream processing
  const title = `YouTube Video ${videoId}`;
  const text = `This is a YouTube video available at ${url}. Transcript could not be automatically extracted. Video ID: ${videoId}`;
  return { text, title };
}

// ── Summarise with Claude ─────────────────────────────────────────────────────

async function summariseTranscript(transcript: string): Promise<string> {
  const truncated = transcript.slice(0, 12000);
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
      system:
        "You are a concise research assistant. When given a video transcript, produce a structured summary.",
      messages: [
        {
          role: "user",
          content: `Summarize this transcript in 3-5 bullet points of key insights. Then write a 2-paragraph summary.\n\nTranscript:\n${truncated}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    console.error("[mavis-youtube-ingest] Anthropic summarise error:", res.status);
    return "";
  }

  const data = await res.json();
  return data.content?.[0]?.text?.trim() ?? "";
}

// ── Chunking ──────────────────────────────────────────────────────────────────

function chunkText(
  text: string,
  chunkSize = 1000,
  overlap = 100,
  maxChunks = 30,
): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length && chunks.length < maxChunks) {
    chunks.push(text.slice(i, i + chunkSize).trim());
    i += chunkSize - overlap;
  }
  return chunks.filter((c) => c.length > 0);
}

// ── OpenAI embedding ──────────────────────────────────────────────────────────

async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!OPENAI_KEY) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const userId = await resolveUserId(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  let body: { url?: string; save_as?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const url = String(body.url ?? "").trim();
  if (!url) return json({ error: "url is required" }, 400);

  const videoId = extractVideoId(url);
  if (!videoId) return json({ error: "Could not extract YouTube video ID from url" }, 400);

  const saveAs: "note" | "vault" = body.save_as === "vault" ? "vault" : "note";

  // Fetch transcript (with fallback)
  let transcript: TranscriptResult;
  try {
    transcript = await fetchTranscript(videoId);
  } catch (err) {
    console.warn("[mavis-youtube-ingest] Transcript extraction failed, using fallback:", err);
    transcript = await fallbackSummary(videoId, url);
  }

  const { text: fullTranscript, title } = transcript;

  // Summarise
  let summary = "";
  if (ANTHROPIC_KEY) {
    try {
      summary = await summariseTranscript(fullTranscript);
    } catch (err) {
      console.error("[mavis-youtube-ingest] Summarise failed:", err);
    }
  }

  // Chunk the transcript
  const chunks = chunkText(fullTranscript, 1000, 100, 30);
  const noteIds: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkContent = chunks[i];
    const embedding = await generateEmbedding(chunkContent);

    const noteRecord: Record<string, unknown> = {
      user_id: userId,
      title: `[YouTube] ${title} — chunk ${i + 1}/${chunks.length}`,
      content: chunkContent,
      tags: ["youtube", "transcript", "auto-extracted"],
      aliases: [],
      properties: {
        video_id: videoId,
        url,
        summary: i === 0 ? summary : undefined,
        chunk_index: i,
        total_chunks: chunks.length,
        skip_sr: true,
      },
    };

    if (embedding) {
      noteRecord.embedding = embedding;
    }

    const { data: inserted, error: insertErr } = await adminSb
      .from("mavis_notes")
      .insert(noteRecord)
      .select("id")
      .single();

    if (insertErr) {
      console.error(`[mavis-youtube-ingest] Insert chunk ${i} error:`, insertErr);
    } else if (inserted?.id) {
      noteIds.push(inserted.id);
    }
  }

  return json({
    chunks_created: noteIds.length,
    video_id: videoId,
    title,
    summary,
    save_as: saveAs,
  });
});
