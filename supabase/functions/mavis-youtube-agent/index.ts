// mavis-youtube-agent
// Search YouTube, fetch video metadata, extract transcripts, and
// summarize videos with structured AI output.
// Transcripts require no auth for public videos. Search requires YOUTUBE_API_KEY.
//
// Actions: search | get_video | get_transcript | list_channel_videos | summarize_video

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_SRK        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const YT_KEY        = Deno.env.get("YOUTUBE_API_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const YT_API        = "https://www.googleapis.com/youtube/v3";

function videoId(input: string): string {
  if (input.length === 11 && !input.includes("/")) return input;
  const m = input.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m?.[1] ?? input.slice(-11);
}

async function ytReq(path: string, params: Record<string, string>): Promise<any> {
  if (!YT_KEY) throw new Error("YouTube Data API not configured. Set YOUTUBE_API_KEY in Supabase secrets. (Transcripts still work without it.)");
  const qs = new URLSearchParams({ ...params, key: YT_KEY }).toString();
  const res = await fetch(`${YT_API}${path}?${qs}`);
  const data = await res.json();
  if (data.error) throw new Error(`YouTube API error (${data.error.code}): ${data.error.message}`);
  return data;
}

async function fetchTranscript(vid: string, lang = "en"): Promise<string> {
  // Step 1: Fetch YouTube page to extract caption track URL
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${vid}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MAVIS/1.0)" },
  });
  const html = await pageRes.text();

  // Extract captions URL from ytInitialPlayerResponse
  const captionMatch = html.match(/"captionTracks":\s*(\[[\s\S]*?\])/);
  if (!captionMatch) return "";

  let tracks: { baseUrl: string; languageCode: string; name?: { simpleText?: string } }[] = [];
  try {
    tracks = JSON.parse(captionMatch[1].replace(/\\u0026/g, "&").replace(/\\\\/g, "\\").replace(/\\"/g, '"'));
  } catch { return ""; }

  // Prefer requested language, fall back to first available
  const track = tracks.find(t => t.languageCode === lang) ?? tracks.find(t => t.languageCode.startsWith("en")) ?? tracks[0];
  if (!track?.baseUrl) return "";

  // Step 2: Fetch VTT/XML transcript
  const transcriptRes = await fetch(track.baseUrl + "&fmt=vtt");
  if (!transcriptRes.ok) return "";
  const vtt = await transcriptRes.text();

  // Step 3: Parse VTT — strip timestamps and tags, join lines
  const lines = vtt.split("\n")
    .filter(l => l.trim() && !l.startsWith("WEBVTT") && !/^\d{2}:\d{2}/.test(l) && !/^NOTE/.test(l))
    .map(l => l.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim())
    .filter(Boolean);

  // Deduplicate consecutive identical lines (VTT overlap)
  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1] !== line) deduped.push(line);
  }

  return deduped.join(" ").replace(/\s+/g, " ").trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${SB_SRK}` && !authHeader.startsWith("Bearer eyJ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body   = await req.json().catch(() => ({}));
    const action = String(body.action ?? "search");

    switch (action) {
      case "search": {
        const query = String(body.query ?? "");
        if (!query) return json({ error: "query required" }, 400);

        const max = Math.min(Number(body.max_results ?? 10), 25);
        const data = await ytReq("/search", {
          part:       "snippet",
          q:          query,
          type:       "video",
          maxResults: String(max),
          order:      String(body.order ?? "relevance"),
          ...(body.channel_id ? { channelId: String(body.channel_id) } : {}),
          ...(body.published_after ? { publishedAfter: String(body.published_after) } : {}),
        });

        return json({
          videos: (data.items ?? []).map((v: any) => ({
            video_id:    v.id.videoId,
            title:       v.snippet.title,
            channel:     v.snippet.channelTitle,
            channel_id:  v.snippet.channelId,
            published:   v.snippet.publishedAt,
            description: v.snippet.description?.slice(0, 200),
            thumbnail:   v.snippet.thumbnails?.medium?.url,
            url:         `https://www.youtube.com/watch?v=${v.id.videoId}`,
          })),
          query,
          total: data.pageInfo?.totalResults,
        });
      }

      case "get_video": {
        const vid = videoId(String(body.video_id ?? body.url ?? ""));
        if (!vid) return json({ error: "video_id or url required" }, 400);

        const data = await ytReq("/videos", {
          part: "snippet,contentDetails,statistics",
          id:   vid,
        });

        const v = data.items?.[0];
        if (!v) return json({ error: "Video not found" }, 404);

        return json({
          video_id:    v.id,
          title:       v.snippet.title,
          channel:     v.snippet.channelTitle,
          channel_id:  v.snippet.channelId,
          published:   v.snippet.publishedAt,
          description: v.snippet.description?.slice(0, 1000),
          duration:    v.contentDetails.duration,
          views:       v.statistics.viewCount,
          likes:       v.statistics.likeCount,
          comments:    v.statistics.commentCount,
          tags:        v.snippet.tags?.slice(0, 20) ?? [],
          url:         `https://www.youtube.com/watch?v=${v.id}`,
        });
      }

      case "get_transcript": {
        const vid  = videoId(String(body.video_id ?? body.url ?? ""));
        const lang = String(body.language ?? "en");
        if (!vid) return json({ error: "video_id or url required" }, 400);

        const transcript = await fetchTranscript(vid, lang);
        if (!transcript) return json({ error: "No transcript available for this video", video_id: vid }, 404);

        return json({
          video_id:   vid,
          language:   lang,
          transcript: transcript.slice(0, body.max_chars ? Number(body.max_chars) : 10000),
          char_count: transcript.length,
          url:        `https://www.youtube.com/watch?v=${vid}`,
        });
      }

      case "list_channel_videos": {
        const channelId = String(body.channel_id ?? "");
        if (!channelId) return json({ error: "channel_id required" }, 400);

        const max = Math.min(Number(body.max_results ?? 20), 50);
        const data = await ytReq("/search", {
          part:       "snippet",
          channelId,
          type:       "video",
          order:      String(body.order ?? "date"),
          maxResults: String(max),
        });

        return json({
          channel_id: channelId,
          videos: (data.items ?? []).map((v: any) => ({
            video_id:  v.id.videoId,
            title:     v.snippet.title,
            published: v.snippet.publishedAt,
            thumbnail: v.snippet.thumbnails?.medium?.url,
            url:       `https://www.youtube.com/watch?v=${v.id.videoId}`,
          })),
        });
      }

      case "summarize_video": {
        // Full pipeline: transcript → structured AI summary → store in memory → return
        const vid  = videoId(String(body.video_id ?? body.url ?? ""));
        const lang = String(body.language ?? "en");
        const uid  = body.userId ? String(body.userId) : null;

        if (!vid) return json({ error: "video_id or url required" }, 400);
        if (!ANTHROPIC_KEY) return json({ error: "ANTHROPIC_API_KEY not configured" }, 503);

        const ytUrl = `https://www.youtube.com/watch?v=${vid}`;

        // Step 1: Get title/channel (best-effort — only needs YT_KEY)
        let title   = `YouTube Video ${vid}`;
        let channel = "";
        if (YT_KEY) {
          try {
            const meta = await ytReq("/videos", { part: "snippet,contentDetails", id: vid });
            const v = meta.items?.[0];
            if (v) {
              title   = v.snippet.title ?? title;
              channel = v.snippet.channelTitle ?? "";
            }
          } catch { /* no YT key or API error — title stays as placeholder */ }
        } else {
          // Extract title from YouTube page HTML
          try {
            const pageRes = await fetch(`https://www.youtube.com/watch?v=${vid}`, {
              headers: { "User-Agent": "Mozilla/5.0 (compatible; MAVIS/1.0)" },
            });
            const html  = await pageRes.text();
            const titleM = html.match(/"title":\s*"([^"]+)"/);
            if (titleM) title = titleM[1].replace(/\\u[\da-f]{4}/gi, c =>
              String.fromCharCode(parseInt(c.slice(2), 16)));
          } catch { /* ignore */ }
        }

        // Step 2: Fetch transcript
        const transcript = await fetchTranscript(vid, lang);
        if (!transcript) {
          return json({ error: "No transcript available for this video. It may be disabled or private.", video_id: vid, url: ytUrl }, 404);
        }

        const wordCount   = transcript.split(/\s+/).filter(Boolean).length;
        const readingTime = Math.max(1, Math.ceil(wordCount / 200));

        // Step 3: Structured summary with Claude
        // Format mirrors n8n template but uses Telegram Markdown (** vs <b>)
        const summaryPrompt = body.summary_prompt ?? `Analyze this YouTube video transcript and produce a structured summary in exactly this format:

## General Summary
One concise paragraph describing the main topic and purpose.

## Key Moments
• **Key Term** — what was said or demonstrated
• **Key Term** — insight or takeaway
(5-10 bullet points covering the most important content)

## Instructions
If this video contains a tutorial or step-by-step guide, list the steps numbered. If not, write: "This video does not contain step-by-step instructions."

Rules:
- Use **bold** for important terms in Key Moments
- Be concrete — include specific names, numbers, techniques mentioned
- Keep the total response under 800 words
- Write as if briefing someone who hasn't seen the video`;

        const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key":         ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
            "content-type":      "application/json",
          },
          body: JSON.stringify({
            model:      body.model ?? "claude-haiku-4-5-20251001",
            max_tokens: 1200,
            system:     `You are summarizing a YouTube video titled: "${title}"${channel ? ` by ${channel}` : ""}. URL: ${ytUrl}`,
            messages: [{
              role:    "user",
              content: `${summaryPrompt}\n\nTranscript:\n${transcript.slice(0, 12000)}`,
            }],
          }),
          signal: AbortSignal.timeout(30000),
        });
        const claudeData = await claudeRes.json();
        if (!claudeRes.ok) {
          throw new Error(`Claude: ${claudeData.error?.message ?? JSON.stringify(claudeData).slice(0, 200)}`);
        }
        const summary = claudeData.content?.[0]?.text ?? "";

        // Step 4: Store full transcript in mavis_memory so operator can Q&A later
        let storedInMemory = false;
        if (uid) {
          const sb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });
          const memContent = `[VIDEO TRANSCRIPT] "${title}" (${ytUrl})\nChannel: ${channel}\n\n${transcript}`;
          await sb.from("mavis_memory").upsert({
            user_id:          uid,
            role:             "system",
            content:          memContent.slice(0, 50000),
            importance_score: 6,
            tags:             ["youtube_transcript", vid, "video_context"],
          }, { onConflict: "user_id,tags" }).catch(() => {});
          storedInMemory = true;
        }

        return json({
          video_id:          vid,
          url:               ytUrl,
          title,
          channel,
          summary,
          word_count:        wordCount,
          reading_time_minutes: readingTime,
          transcript_length: transcript.length,
          stored_in_memory:  storedInMemory,
          memory_note:       storedInMemory
            ? "Transcript stored in MAVIS memory. You can now ask questions about this video in chat."
            : "Pass userId to store transcript for Q&A.",
        });
      }

      default:
        return json({ error: `Unknown action: ${action}. Use: search | get_video | get_transcript | list_channel_videos | summarize_video` }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-youtube-agent]", message);
    return json({ error: message }, message.includes("not configured") ? 503 : 500);
  }
});
