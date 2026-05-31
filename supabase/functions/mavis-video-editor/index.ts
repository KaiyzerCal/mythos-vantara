// MAVIS Video Editor — Core AI video analysis engine for MAVIS Creator Studio
// Pipeline: Whisper transcription → Gemini 2.0 Flash multimodal analysis →
// multi-dimensional moment scoring → segment windows → clip recommendations per format.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const OPENAI_KEY = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const FAL_KEY = Deno.env.get("FAL_API_KEY") ?? "";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface GeminiAnalysis {
  title?: string;
  summary?: string;
  total_duration_estimate?: number;
  content_type?: string;
  top_moments: Array<{
    start: number;
    end: number;
    title: string;
    transcript_excerpt?: string;
    scores: {
      energy: number;
      insight: number;
      emotion: number;
      hook: number;
      quotability: number;
      visual: number;
    };
    viral_score: number;
    why_viral?: string;
    suggested_caption?: string;
    suggested_hashtags?: string[];
    best_format?: string;
  }>;
  full_clip_recommendation?: {
    best_15s?: { start: number; end: number; hook: string };
    best_60s?: { start: number; end: number; hook: string };
    best_90s?: { start: number; end: number; hook: string };
  };
}

interface ScoredSegment {
  start_seconds: number;
  end_seconds: number;
  transcript_text: string;
  energy: number;
  insight: number;
  emotion: number;
  hook: number;
  quotability: number;
  visual: number;
  viral_score: number;
  segment_order: number;
}

interface ClipRecommendation {
  start: number;
  end: number;
  title: string;
  viral_score: number;
  why_viral?: string;
  suggested_caption?: string;
  suggested_hashtags?: string[];
  format: string;
  aspect_ratio: string;
  transcript_excerpt?: string;
  weighted_score?: number;
}

// ─────────────────────────────────────────────────────────────
// Step 2: Whisper transcription
// ─────────────────────────────────────────────────────────────

async function transcribeWithWhisper(videoUrl: string): Promise<{
  text: string;
  chunks: Array<{ start: number; end: number; text: string }>;
}> {
  // Download video/audio. For Supabase Storage URLs, download directly via the
  // storage SDK using the service role key — this bypasses the public CDN
  // (which rate-limits with 429 + HTML error pages) and works for both public
  // and private buckets.
  let videoBlob: Blob | null = null;
  let responseContentType = "";

  const storageMatch = videoUrl.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?]+)/);
  if (storageMatch && SUPABASE_SERVICE_KEY) {
    const bucket = storageMatch[1];
    const objectPath = decodeURIComponent(storageMatch[2]);
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: dlData, error: dlErr } = await sb.storage.from(bucket).download(objectPath);
    if (dlErr || !dlData) {
      throw new Error(`Failed to download video from storage: ${dlErr?.message ?? "no data"}`);
    }
    videoBlob = dlData;
    responseContentType = dlData.type ?? "";
  } else {
    // External URL — fetch with retry on 429
    let videoRes: Response | null = null;
    let lastErr = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      videoRes = await fetch(videoUrl, { signal: AbortSignal.timeout(90000) });
      if (videoRes.ok) break;
      lastErr = `${videoRes.status}: ${(await videoRes.text()).slice(0, 200)}`;
      if (videoRes.status === 429 || videoRes.status >= 500) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      break;
    }
    if (!videoRes || !videoRes.ok) {
      throw new Error(`Failed to fetch video (${lastErr})`);
    }
    videoBlob = await videoRes.blob();
    responseContentType = videoRes.headers.get("content-type") ?? videoBlob.type ?? "";
  }

  if (!videoBlob || videoBlob.size === 0) throw new Error("Video file is empty");
  if (videoBlob.size > 24 * 1024 * 1024) {
    throw new Error(
      `Video file is too large for transcription (${(videoBlob.size / 1024 / 1024).toFixed(0)} MB). ` +
      `Please upload a video under 24 MB, or trim it to under 5 minutes first.`
    );
  }


  // Whisper only accepts a narrow set of media containers/codecs. Re-labelling a
  // QuickTime/MOV blob as MP4 does not transcode it, so reject unsupported inputs
  // early with a clear error instead of sending a guaranteed-bad request upstream.
  const MIME_MAP: Record<string, string> = {
    flac: "audio/flac",
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    mpeg: "video/mpeg",
    mpga: "audio/mpeg",
    oga: "audio/ogg",
    ogg: "audio/ogg",
    wav: "audio/wav",
    webm: "video/webm",
  };
  const MIME_TO_EXT: Record<string, string> = {
    "audio/flac": "flac",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/webm": "webm",
    "audio/x-flac": "flac",
    "audio/x-wav": "wav",
    "video/mp4": "mp4",
    "video/mpeg": "mpeg",
    "video/ogg": "ogg",
    "video/webm": "webm",
  };
  const WHISPER_EXTS = new Set(["flac", "m4a", "mp3", "mp4", "mpeg", "mpga", "oga", "ogg", "wav", "webm"]);
  const rawExt = (videoUrl.split("?")[0].split(".").pop() ?? "").toLowerCase();
  const responseMimeType = (videoBlob.type || videoRes.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const ext = WHISPER_EXTS.has(rawExt) ? rawExt : (MIME_TO_EXT[responseMimeType] ?? "");

  if (!ext) {
    const suffix = rawExt ? ` (.${rawExt})` : "";
    throw new Error(
      `Unsupported audio/video format for transcription${suffix}. ` +
      `Please upload MP4, MPEG, WebM, OGG/OGA, M4A, MP3, WAV, or FLAC. ` +
      `QuickTime/MOV files must be converted to MP4 first.`
    );
  }

  const mimeType = MIME_MAP[ext] ?? responseMimeType;
  const fileBlob = new Blob([await videoBlob.arrayBuffer()], { type: mimeType });

  const form = new FormData();
  form.append("file", fileBlob, `media.${ext}`);
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: form,
    signal: AbortSignal.timeout(90000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whisper error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const chunks = (data.segments ?? []).map((s: any) => ({
    start: s.start,
    end: s.end,
    text: s.text.trim(),
  }));

  return { text: data.text ?? "", chunks };
}

// ─────────────────────────────────────────────────────────────
// Step 3: Gemini visual + transcript analysis (with fallback)
// ─────────────────────────────────────────────────────────────

async function analyzeWithGemini(videoUrl: string, transcript: string): Promise<GeminiAnalysis> {
  const prompt = `You are an expert video editor and content strategist. Analyze this video and identify the most compelling moments for social media clips.

TRANSCRIPT (use these timestamps for precision):
${transcript.slice(0, 8000)}

Evaluate the entire video and return ONLY valid JSON:
{
  "title": "descriptive video title (max 60 chars)",
  "summary": "2-sentence overview of the video content",
  "total_duration_estimate": number_in_seconds,
  "content_type": "podcast|interview|tutorial|vlog|keynote|performance|sports|other",
  "top_moments": [
    {
      "start": seconds_float,
      "end": seconds_float,
      "title": "moment title (max 80 chars)",
      "transcript_excerpt": "exact quote from transcript",
      "scores": {
        "energy": 0_to_10,
        "insight": 0_to_10,
        "emotion": 0_to_10,
        "hook": 0_to_10,
        "quotability": 0_to_10,
        "visual": 0_to_10
      },
      "viral_score": 0_to_10,
      "why_viral": "1-2 sentence explanation of why this moment will perform",
      "suggested_caption": "platform-optimized caption with hook line, 150 chars max",
      "suggested_hashtags": ["hashtag1", "hashtag2", "hashtag3"],
      "best_format": "shorts|reels|highlight|long_form"
    }
  ],
  "full_clip_recommendation": {
    "best_15s": { "start": float, "end": float, "hook": "why this is the best 15s" },
    "best_60s": { "start": float, "end": float, "hook": "why this is the best 60s" },
    "best_90s": { "start": float, "end": float, "hook": "why this is the best 90s" }
  }
}

Scoring guidelines:
- energy (0-10): speaking pace, vocal intensity, exclamations, momentum
- insight (0-10): density of novel/valuable information, data points, actionable advice
- emotion (0-10): emotional language, storytelling, vulnerability, excitement, humor
- hook (0-10): does it open with a surprising claim, question, or bold statement?
- quotability (0-10): is it a complete, standalone thought that works out of context?
- visual (0-10): estimate based on content type — demonstrations, reveals, reactions score higher

Return 6-12 top moments minimum. Focus on clips 15-120 seconds long.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              { fileData: { mimeType: "video/mp4", fileUri: videoUrl } },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
      }),
      signal: AbortSignal.timeout(90000),
    }
  );

  if (!res.ok) {
    // Fallback: analyze from transcript only (no video file)
    return await analyzeFromTranscriptOnly(transcript);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) return await analyzeFromTranscriptOnly(transcript);
  try {
    const parsed = JSON.parse(text) as GeminiAnalysis;
    if (!parsed.top_moments?.length) return await analyzeFromTranscriptOnly(transcript);
    return parsed;
  } catch {
    return await analyzeFromTranscriptOnly(transcript);
  }
}

// Fallback: transcript-only analysis when video URL isn't directly accessible by Gemini
async function analyzeFromTranscriptOnly(transcript: string): Promise<GeminiAnalysis> {
  const prompt = `You are an expert video editor. Based on this transcript, identify the most compelling moments for social media clips.

TRANSCRIPT:
${transcript.slice(0, 12000)}

Return ONLY valid JSON:
{
  "title": "string",
  "summary": "string",
  "total_duration_estimate": number,
  "content_type": "education|entertainment|interview|tutorial|vlog|other",
  "top_moments": [
    {
      "start": number,
      "end": number,
      "title": "string",
      "transcript_excerpt": "string",
      "scores": { "energy": 0-10, "insight": 0-10, "emotion": 0-10, "hook": 0-10, "quotability": 0-10, "visual": 0-10 },
      "viral_score": 0-10,
      "why_viral": "string",
      "suggested_caption": "string",
      "suggested_hashtags": ["string"]
    }
  ]
}

Rules:
- Return 6-10 top_moments minimum
- Each moment should be 20-90 seconds long
- Estimate timestamps from speaking pace (~150 words/min = 2.5 words/sec)
- Space moments throughout the full video, not just the beginning`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
        }),
        signal: AbortSignal.timeout(60000),
      }
    );

    if (!res.ok) return buildSyntheticAnalysis(transcript);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text) as GeminiAnalysis;
    if (!parsed.top_moments?.length) return buildSyntheticAnalysis(transcript);
    return parsed;
  } catch {
    return buildSyntheticAnalysis(transcript);
  }
}

// Last-resort: build synthetic top_moments directly from transcript timing.
// Guaranteed to return at least 1 moment even with an empty transcript.
function buildSyntheticAnalysis(transcript: string, knownDuration?: number): GeminiAnalysis {
  const trimmed = transcript.trim();
  const words = trimmed ? trimmed.split(/\s+/) : [];
  const wordsPerSecond = 2.5;
  // Use known duration if provided; estimate from word count otherwise, minimum 60s
  const totalSeconds = knownDuration ?? Math.max(Math.ceil(words.length / wordsPerSecond), 60);
  const clipDuration = Math.min(45, Math.floor(totalSeconds / 2) || 30);
  const moments: GeminiAnalysis["top_moments"] = [];

  const makeScores = (text: string) => {
    const s = estimateScoresFromText(text);
    return s as GeminiAnalysis["top_moments"][0]["scores"];
  };

  for (let start = 0; start < totalSeconds; start += clipDuration) {
    const end = Math.min(start + clipDuration, totalSeconds);
    const wordStart = Math.floor(start * wordsPerSecond);
    const wordEnd = Math.min(Math.floor(end * wordsPerSecond), words.length);
    const excerpt = words.length > 0
      ? words.slice(wordStart, wordEnd).join(" ").slice(0, 300)
      : `Segment ${moments.length + 1}`;
    const scores = makeScores(excerpt);
    const viral_score = Math.round(
      scores.hook * 0.25 + scores.energy * 0.20 + scores.emotion * 0.25 +
      scores.quotability * 0.15 + scores.insight * 0.10 + scores.visual * 0.05
    );
    moments.push({
      start,
      end,
      title: excerpt.split(/[.!?]/)[0]?.slice(0, 80) || `Segment ${moments.length + 1}`,
      transcript_excerpt: excerpt,
      scores,
      viral_score: Math.max(viral_score, 4), // floor at 4 so clips always rank
    });
    if (moments.length >= 10) break;
  }

  // Absolute guarantee: if loop produced nothing, emit one full-video moment
  if (moments.length === 0) {
    moments.push({
      start: 0,
      end: totalSeconds,
      title: "Full Video",
      transcript_excerpt: trimmed.slice(0, 200) || "No transcript available",
      scores: { energy: 5, insight: 5, emotion: 5, hook: 5, quotability: 5, visual: 5 },
      viral_score: 5,
    });
  }

  return {
    title: "Video Analysis",
    summary: transcript.slice(0, 200),
    total_duration_estimate: totalSeconds,
    content_type: "other",
    top_moments: moments,
  };
}

// ─────────────────────────────────────────────────────────────
// Step 4: Text-based score estimator (fallback for segments without Gemini coverage)
// ─────────────────────────────────────────────────────────────

function estimateScoresFromText(text: string): Record<string, number> {
  const words = text.toLowerCase().split(/\s+/);
  const energyWords = ["amazing", "incredible", "wow", "huge", "never", "always", "must", "critical", "urgent", "now", "finally", "!"];
  const insightWords = ["because", "therefore", "study", "data", "percent", "%", "research", "proven", "actually", "key", "secret"];
  const emotionWords = ["love", "hate", "fear", "excited", "angry", "proud", "changed", "transform", "realize", "feel", "heart"];

  const energy = Math.min(10, words.filter(w => energyWords.some(e => w.includes(e))).length * 2 + 3);
  const insight = Math.min(10, words.filter(w => insightWords.some(e => w.includes(e))).length * 2 + 2);
  const emotion = Math.min(10, words.filter(w => emotionWords.some(e => w.includes(e))).length * 2 + 2);
  const hook = text.includes("?") || text.startsWith("The") || text.includes("secret") ? 7 : 4;
  const quotability = text.split(".").filter(s => s.trim().length > 20).length >= 1 ? 6 : 3;
  const visual = 4;

  return { energy, insight, emotion, hook, quotability, visual };
}

// ─────────────────────────────────────────────────────────────
// Step 4: Build scored 10-second segment windows
// ─────────────────────────────────────────────────────────────

function buildScoredSegments(
  chunks: Array<{ start: number; end: number; text: string }>,
  moments: GeminiAnalysis["top_moments"]
): ScoredSegment[] {
  if (chunks.length === 0) return [];

  const totalDuration = chunks[chunks.length - 1].end;
  const windowSize = 10; // seconds
  const segments: ScoredSegment[] = [];

  for (let start = 0; start < totalDuration; start += windowSize) {
    const end = Math.min(start + windowSize, totalDuration);
    const windowChunks = chunks.filter(c => c.start >= start && c.start < end);
    const text = windowChunks.map(c => c.text).join(" ").trim();
    if (!text) continue;

    // Find overlapping Gemini moments and inherit their scores (take max per dimension)
    const overlapping = moments.filter(m =>
      (m.start <= end && m.end >= start)
    );

    const baseScores = overlapping.length > 0
      ? overlapping.reduce((acc, m) => ({
          energy: Math.max(acc.energy, m.scores.energy),
          insight: Math.max(acc.insight, m.scores.insight),
          emotion: Math.max(acc.emotion, m.scores.emotion),
          hook: Math.max(acc.hook, m.scores.hook),
          quotability: Math.max(acc.quotability, m.scores.quotability),
          visual: Math.max(acc.visual, m.scores.visual),
        }), { energy: 0, insight: 0, emotion: 0, hook: 0, quotability: 0, visual: 0 })
      : estimateScoresFromText(text);

    const viral_score = (
      baseScores.hook * 0.25 +
      baseScores.energy * 0.20 +
      baseScores.emotion * 0.25 +
      baseScores.quotability * 0.15 +
      baseScores.insight * 0.10 +
      baseScores.visual * 0.05
    );

    segments.push({
      start_seconds: start,
      end_seconds: end,
      transcript_text: text,
      energy: baseScores.energy,
      insight: baseScores.insight,
      emotion: baseScores.emotion,
      hook: baseScores.hook,
      quotability: baseScores.quotability,
      visual: baseScores.visual,
      viral_score: Math.round(viral_score * 10) / 10,
      segment_order: segments.length,
    });
  }

  return segments;
}

// ─────────────────────────────────────────────────────────────
// Step 5: Select top clips per format with weighted scoring
// ─────────────────────────────────────────────────────────────

function selectClipsForFormat(
  moments: GeminiAnalysis["top_moments"],
  format: string,
  count: number
): ClipRecommendation[] {
  if (moments.length === 0) return [];

  const weights: Record<string, Record<string, number>> = {
    shorts: { hook: 0.35, energy: 0.20, emotion: 0.25, quotability: 0.20 },
    reels: { hook: 0.30, emotion: 0.30, energy: 0.20, quotability: 0.20 },
    highlight: { energy: 0.30, emotion: 0.35, visual: 0.35 },
    long_form: { insight: 0.45, quotability: 0.30, energy: 0.25 },
  };

  const w = weights[format] ?? weights.shorts;

  const durationRange: Record<string, [number, number]> = {
    shorts: [15, 60],
    reels: [15, 90],
    highlight: [30, 120],
    long_form: [60, 300],
  };
  const [minDur, maxDur] = durationRange[format] ?? [15, 90];

  const aspectRatio: Record<string, string> = {
    shorts: "9:16",
    reels: "9:16",
    highlight: "16:9",
    long_form: "16:9",
  };

  const scoreAndWrap = (m: GeminiAnalysis["top_moments"][0]): ClipRecommendation => {
    const weighted_score = Object.entries(w).reduce((acc, [key, weight]) =>
      acc + (m.scores[key as keyof typeof m.scores] ?? 5) * weight, 0
    );
    return {
      start: m.start,
      end: m.end,
      title: m.title,
      viral_score: m.viral_score,
      why_viral: m.why_viral,
      suggested_caption: m.suggested_caption,
      suggested_hashtags: m.suggested_hashtags,
      transcript_excerpt: m.transcript_excerpt,
      format,
      aspect_ratio: aspectRatio[format] ?? "9:16",
      weighted_score,
    };
  };

  // Tier 1: strict duration match
  let candidates = moments.filter(m => {
    const dur = m.end - m.start;
    return dur >= minDur && dur <= maxDur;
  });

  // Tier 2: relaxed — only enforce a 5-second minimum, ignore max
  if (candidates.length < count) {
    const relaxed = moments.filter(m => (m.end - m.start) >= 5);
    if (relaxed.length > candidates.length) candidates = relaxed;
  }

  // Tier 3: all moments — never return empty if there's anything at all
  if (candidates.length === 0) candidates = [...moments];

  return candidates
    .map(scoreAndWrap)
    .sort((a, b) => (b.weighted_score ?? 0) - (a.weighted_score ?? 0))
    .slice(0, count);
}

// Merge adjacent 10-second segments into longer moments suitable for clip selection.
// Used by handleGenerateClips when only segment windows (not raw Gemini moments) are available.
function mergeSegmentsIntoMoments(
  segments: any[],
  targetMin: number,
  targetMax: number,
): GeminiAnalysis["top_moments"] {
  if (segments.length === 0) return [];

  const sorted = [...segments].sort((a, b) => a.start_seconds - b.start_seconds);
  const targetDur = Math.min((targetMin + targetMax) / 2, targetMax);
  const moments: GeminiAnalysis["top_moments"] = [];
  const used = new Set<number>();

  // Pick seed segments by viral score, expand each into a clip
  const byScore = [...sorted].sort((a, b) => (b.viral_score ?? 0) - (a.viral_score ?? 0));

  for (const seed of byScore) {
    const seedIdx = sorted.findIndex(s => s.start_seconds === seed.start_seconds);
    if (used.has(seedIdx)) continue;

    let startIdx = seedIdx;
    let endIdx = seedIdx;

    // Expand forward until we hit target duration or run out of segments
    while (
      endIdx + 1 < sorted.length &&
      (sorted[endIdx].end_seconds - sorted[startIdx].start_seconds) < targetDur
    ) {
      endIdx++;
    }

    const clipStart = sorted[startIdx].start_seconds;
    const clipEnd = Math.min(sorted[endIdx].end_seconds, clipStart + targetMax);
    const window = sorted.slice(startIdx, endIdx + 1);

    const avg = (key: string) =>
      window.reduce((s, seg) => s + (seg[`score_${key}`] ?? 5), 0) / window.length;

    moments.push({
      start: clipStart,
      end: clipEnd,
      title: seed.transcript_text?.slice(0, 80) ?? "Highlight",
      transcript_excerpt: window.map((s: any) => s.transcript_text).join(" ").slice(0, 400),
      scores: {
        energy: avg("energy"),
        insight: avg("insight"),
        emotion: avg("emotion"),
        hook: avg("hook"),
        quotability: avg("quotability"),
        visual: avg("visual"),
      },
      viral_score: seed.viral_score ?? 5,
    });

    for (let i = startIdx; i <= endIdx; i++) used.add(i);
    if (moments.length >= 15) break;
  }

  return moments;
}

// ─────────────────────────────────────────────────────────────
// Action handlers
// ─────────────────────────────────────────────────────────────

async function handleAnalyze(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: {
    source_url: string;
    source_type?: string;
    title?: string;
    language?: string;
  }
) {
  const { source_url, source_type = "url", title, language } = body;

  if (!source_url?.trim()) {
    throw new Error("source_url is required");
  }

  // Step 1: Create project record with status "analyzing"
  const { data: project, error: projectErr } = await supabase
    .from("video_projects")
    .insert({
      user_id: userId,
      title: title ?? "Untitled Video",
      source_url,
      source_type,
      language: language ?? "en",
      status: "analyzing",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (projectErr) {
    throw new Error(`Failed to create project: ${projectErr.message}`);
  }

  const projectId: string = project.id;

  try {
    // Step 2: Transcribe with Whisper
    console.log(`[mavis-video-editor] Transcribing project ${projectId}...`);
    const { text: transcript, chunks } = await transcribeWithWhisper(source_url);

    // Step 3: Gemini visual + semantic analysis
    console.log(`[mavis-video-editor] Running Gemini analysis for project ${projectId}...`);
    const analysis = await analyzeWithGemini(source_url, transcript);

    // Estimate video duration from Whisper chunks if Gemini didn't report it
    const chunksDuration = chunks.length > 0 ? chunks[chunks.length - 1].end : undefined;

    // Use Gemini moments if available; fall back to synthetic moments from transcript
    const moments = (analysis.top_moments?.length ?? 0) > 0
      ? analysis.top_moments
      : buildSyntheticAnalysis(transcript, chunksDuration).top_moments;

    console.log(`[mavis-video-editor] ${moments.length} moments, transcript ${transcript.length} chars`);

    console.log(`[mavis-video-editor] ${moments.length} moments for clip selection`);

    // Step 4: Build scored 10-second segment windows
    const segments = buildScoredSegments(chunks, moments);

    // Step 5: Generate clip recommendations per format
    const formats = ["shorts", "reels", "highlight", "long_form"] as const;
    const clips: Record<string, ClipRecommendation[]> = {};
    for (const fmt of formats) {
      clips[fmt] = selectClipsForFormat(moments, fmt, 5);
      console.log(`[mavis-video-editor] ${fmt}: ${clips[fmt].length} clips`);
    }

    // Find top clip across all formats by viral_score
    const allClips = Object.values(clips).flat();
    const topClip = allClips.sort((a, b) => b.viral_score - a.viral_score)[0] ?? null;

    const durationSeconds = analysis.total_duration_estimate
      ?? (chunks.length > 0 ? chunks[chunks.length - 1].end : 0);

    // Step 6: Update project record to "ready" with analysis results
    const { error: updateErr } = await supabase
      .from("video_projects")
      .update({
        title: analysis.title ?? title ?? "Untitled Video",
        summary: analysis.summary ?? "",
        duration_seconds: durationSeconds,
        transcript,
        content_type: analysis.content_type ?? "other",
        status: "ready",
        full_clip_recommendation: analysis.full_clip_recommendation ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    if (updateErr) {
      console.error(`[mavis-video-editor] Project update error:`, updateErr.message);
    }

    // Insert segments (bulk)
    if (segments.length > 0) {
      const segmentRows = segments.map(s => ({
        project_id: projectId,
        user_id: userId,
        start_seconds: s.start_seconds,
        end_seconds: s.end_seconds,
        transcript_text: s.transcript_text,
        score_energy: s.energy,
        score_insight: s.insight,
        score_emotion: s.emotion,
        score_hook: s.hook,
        score_quotability: s.quotability,
        score_visual: s.visual,
        viral_score: s.viral_score,
        segment_order: s.segment_order,
        created_at: new Date().toISOString(),
      }));

      const { error: segErr } = await supabase
        .from("video_segments")
        .insert(segmentRows);

      if (segErr) {
        console.error(`[mavis-video-editor] Segments insert error:`, segErr.message);
      }
    }

    // Insert clip recommendations (bulk)
    const clipRows: any[] = [];
    for (const [fmt, fmtClips] of Object.entries(clips)) {
      for (const clip of fmtClips) {
        clipRows.push({
          project_id: projectId,
          user_id: userId,
          format: fmt,
          start_seconds: clip.start,
          end_seconds: clip.end,
          title: clip.title,
          viral_score: clip.viral_score,
          why_viral: clip.why_viral ?? null,
          suggested_caption: clip.suggested_caption ?? null,
          suggested_hashtags: clip.suggested_hashtags ?? [],
          transcript_excerpt: clip.transcript_excerpt ?? null,
          aspect_ratio: clip.aspect_ratio,
          weighted_score: clip.weighted_score ?? null,
          status: "pending",
          created_at: new Date().toISOString(),
        });
      }
    }

    if (clipRows.length > 0) {
      const { error: clipErr } = await supabase
        .from("video_clips")
        .insert(clipRows);

      if (clipErr) {
        console.error(`[mavis-video-editor] Clips insert error:`, clipErr.message);
      }
    }

    const totalClips = Object.values(clips).reduce((n, arr) => n + arr.length, 0);
    console.log(`[mavis-video-editor] Done: ${totalClips} clips total, ${segments.length} segments`);

    return {
      project_id: projectId,
      title: analysis.title ?? title ?? "Untitled Video",
      summary: analysis.summary ?? "",
      duration_seconds: durationSeconds,
      transcript,
      segment_count: segments.length,
      clips,
      top_clip: topClip,
      _meta: {
        transcript_chars: transcript.length,
        moments_used: moments.length,
        clips_per_format: Object.fromEntries(Object.entries(clips).map(([k, v]) => [k, v.length])),
      },
    };
  } catch (err: any) {
    // Mark project as failed so UI can show error state
    await supabase
      .from("video_projects")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", projectId);
    throw err;
  }
}

async function handleGenerateClips(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: {
    project_id: string;
    formats?: string[];
    clips_per_format?: number;
  }
) {
  const { project_id, formats = ["shorts", "reels", "highlight", "long_form"], clips_per_format = 5 } = body;

  if (!project_id) throw new Error("project_id is required");

  // Load project
  const { data: project, error: projErr } = await supabase
    .from("video_projects")
    .select("*")
    .eq("id", project_id)
    .eq("user_id", userId)
    .single();

  if (projErr || !project) throw new Error("Project not found");

  // Load transcript chunks (re-use segments for moment data)
  const { data: segments } = await supabase
    .from("video_segments")
    .select("*")
    .eq("project_id", project_id)
    .order("segment_order", { ascending: true });

  // Merge 10-second segments into longer moments per format target duration,
  // then combine all format pools into one deduplicated moment list.
  const durationRanges: Record<string, [number, number]> = {
    shorts: [15, 60], reels: [15, 90], highlight: [30, 120], long_form: [60, 300],
  };
  const allMoments: GeminiAnalysis["top_moments"] = [];
  const seenKeys = new Set<string>();
  for (const fmt of formats) {
    const [mn, mx] = durationRanges[fmt] ?? [15, 90];
    for (const m of mergeSegmentsIntoMoments(segments ?? [], mn, mx)) {
      const key = `${m.start}-${m.end}`;
      if (!seenKeys.has(key)) { seenKeys.add(key); allMoments.push(m); }
    }
  }

  // Rebuild moment list from segments for selectClipsForFormat
  const moments: GeminiAnalysis["top_moments"] = allMoments.length > 0
    ? allMoments
    : (segments ?? []).map((s: any) => ({
    start: s.start_seconds,
    end: s.end_seconds,
    title: s.transcript_text?.slice(0, 80) ?? "Segment",
    transcript_excerpt: s.transcript_text,
    scores: {
      energy: s.score_energy ?? 5,
      insight: s.score_insight ?? 5,
      emotion: s.score_emotion ?? 5,
      hook: s.score_hook ?? 5,
      quotability: s.score_quotability ?? 5,
      visual: s.score_visual ?? 5,
    },
    viral_score: s.viral_score ?? 5,
  }));

  const clips: Record<string, ClipRecommendation[]> = {};
  for (const fmt of formats) {
    clips[fmt] = selectClipsForFormat(moments, fmt, clips_per_format);
  }

  // Delete existing clips for those formats, then re-insert
  await supabase
    .from("video_clips")
    .delete()
    .eq("project_id", project_id)
    .in("format", formats);

  const clipRows: any[] = [];
  for (const [fmt, fmtClips] of Object.entries(clips)) {
    for (const clip of fmtClips) {
      clipRows.push({
        project_id,
        user_id: userId,
        format: fmt,
        start_seconds: clip.start,
        end_seconds: clip.end,
        title: clip.title,
        viral_score: clip.viral_score,
        why_viral: clip.why_viral ?? null,
        suggested_caption: clip.suggested_caption ?? null,
        suggested_hashtags: clip.suggested_hashtags ?? [],
        transcript_excerpt: clip.transcript_excerpt ?? null,
        aspect_ratio: clip.aspect_ratio,
        weighted_score: clip.weighted_score ?? null,
        status: "pending",
        created_at: new Date().toISOString(),
      });
    }
  }

  if (clipRows.length > 0) {
    const { error: clipErr } = await supabase
      .from("video_clips")
      .insert(clipRows);

    if (clipErr) {
      console.error(`[mavis-video-editor] generate_clips insert error:`, clipErr.message);
    }
  }

  return { project_id, clips };
}

async function handlePollRender(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: { render_job_id: string }
) {
  const { render_job_id } = body;
  if (!render_job_id) throw new Error("render_job_id is required");

  // Look up render job status
  const { data: job, error: jobErr } = await supabase
    .from("video_render_jobs")
    .select("*")
    .eq("id", render_job_id)
    .eq("user_id", userId)
    .single();

  if (jobErr || !job) throw new Error("Render job not found");

  // If using fal.ai for rendering, poll their API
  if (job.fal_request_id && FAL_KEY) {
    try {
      const falRes = await fetch(
        `https://queue.fal.run/status/${job.fal_request_id}`,
        {
          headers: { Authorization: `Key ${FAL_KEY}` },
          signal: AbortSignal.timeout(15000),
        }
      );

      if (falRes.ok) {
        const falData = await falRes.json();
        const falStatus = falData.status; // "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED"
        const mappedStatus =
          falStatus === "COMPLETED" ? "done" :
          falStatus === "FAILED" ? "failed" :
          "processing";

        const updatePayload: any = {
          status: mappedStatus,
          updated_at: new Date().toISOString(),
        };

        if (falStatus === "COMPLETED" && falData.result?.video?.url) {
          updatePayload.output_url = falData.result.video.url;
        }

        await supabase
          .from("video_render_jobs")
          .update(updatePayload)
          .eq("id", render_job_id);

        return { render_job_id, status: mappedStatus, output_url: updatePayload.output_url ?? null };
      }
    } catch (e: any) {
      console.error("[mavis-video-editor] fal.ai poll error:", e?.message);
    }
  }

  return { render_job_id, status: job.status, output_url: job.output_url ?? null };
}

async function handleGetProject(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: { project_id: string }
) {
  const { project_id } = body;
  if (!project_id) throw new Error("project_id is required");

  const [{ data: project, error: projErr }, { data: segments }, { data: clips }] =
    await Promise.all([
      supabase
        .from("video_projects")
        .select("*")
        .eq("id", project_id)
        .eq("user_id", userId)
        .single(),
      supabase
        .from("video_segments")
        .select("*")
        .eq("project_id", project_id)
        .order("segment_order", { ascending: true }),
      supabase
        .from("video_clips")
        .select("*")
        .eq("project_id", project_id)
        .order("viral_score", { ascending: false }),
    ]);

  if (projErr || !project) throw new Error("Project not found");

  // Group clips by format
  const clipsByFormat: Record<string, any[]> = {};
  for (const clip of clips ?? []) {
    if (!clipsByFormat[clip.format]) clipsByFormat[clip.format] = [];
    clipsByFormat[clip.format].push(clip);
  }

  return { project, segments: segments ?? [], clips: clipsByFormat };
}

// ─────────────────────────────────────────────────────────────
// Auth helper — accepts JWT (user) or service role key + user_id
// ─────────────────────────────────────────────────────────────

async function resolveUser(
  req: Request,
  supabase: ReturnType<typeof createClient>,
  body: any
): Promise<{ id: string }> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  // Service role call: jwt === SUPABASE_SERVICE_KEY and body.user_id provided
  if (jwt === SUPABASE_SERVICE_KEY && body?.user_id) {
    return { id: body.user_id };
  }

  if (!jwt) throw new Error("Unauthorized");

  const { data: { user }, error } = await supabase.auth.getUser(jwt);
  if (error || !user) throw new Error("Unauthorized");
  return user;
}

// ─────────────────────────────────────────────────────────────
// Main serve handler
// ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let user: { id: string };
  try {
    user = await resolveUser(req, supabase, body);
  } catch {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { action } = body;

  try {
    let result: any;

    switch (action) {
      case "analyze":
        result = await handleAnalyze(supabase, user.id, body);
        break;

      case "generate_clips":
        result = await handleGenerateClips(supabase, user.id, body);
        break;

      case "poll_render":
        result = await handlePollRender(supabase, user.id, body);
        break;

      case "get_project":
        result = await handleGetProject(supabase, user.id, body);
        break;

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: "${action}". Valid actions: analyze, generate_clips, poll_render, get_project` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error(`[mavis-video-editor] action=${action} error:`, err?.message);
    return new Response(
      JSON.stringify({ error: err?.message ?? "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
