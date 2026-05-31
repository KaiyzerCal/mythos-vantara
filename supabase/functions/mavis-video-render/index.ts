import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FAL_KEY = Deno.env.get("FAL_API_KEY") ?? "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";

// ── Types ──────────────────────────────────────────────────

interface RenderAction {
  action: "render";
  user_id: string;
  clip_id: string;
  source_url: string;
  start_seconds: number;
  end_seconds: number;
  aspect_ratio?: "9:16" | "16:9" | "1:1";
  add_captions?: boolean;
  caption_style?: "white_bold" | "yellow" | "gradient" | "minimal";
  caption_text?: string;
}

interface PollAction {
  action: "poll";
  job_id: string;
  user_id: string;
}

interface ExtractThumbnailAction {
  action: "extract_thumbnail";
  source_url: string;
  timestamp_seconds: number;
  user_id: string;
  clip_id?: string;
}

interface CompileAction {
  action: "compile";
  user_id: string;
  source_url: string;
  clips: Array<{ start: number; end: number; title: string }>;
  aspect_ratio?: "9:16" | "16:9" | "1:1";
  add_fades?: boolean;
}

type VideoRenderAction = RenderAction | PollAction | ExtractThumbnailAction | CompileAction;

// ── FFmpeg helpers ─────────────────────────────────────────

function buildFfmpegArgs(
  start: number,
  end: number,
  aspectRatio: string,
  addCaptions: boolean,
  captionText?: string,
  captionStyle?: string,
): string[] {
  const duration = end - start;
  const args: string[] = [
    "-i", "input.mp4",
    "-ss", String(start),
    "-t", String(duration),
  ];

  // Aspect ratio filter
  const cropFilter = aspectRatio === "9:16"
    ? "crop=ih*9/16:ih,scale=1080:1920"
    : aspectRatio === "1:1"
    ? "crop=ih:ih,scale=1080:1080"
    : "scale=1920:1080"; // 16:9 default

  // Caption filter (burn-in subtitles)
  const captionFilters: string[] = [];
  if (addCaptions && captionText) {
    const styleMap: Record<string, string> = {
      white_bold: "fontsize=48:fontcolor=white:bordercolor=black:borderw=3:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
      yellow: "fontsize=48:fontcolor=yellow:bordercolor=black:borderw=2",
      minimal: "fontsize=36:fontcolor=white:alpha=0.9",
      gradient: "fontsize=44:fontcolor=white:bordercolor=black:borderw=2",
    };
    const style = styleMap[captionStyle ?? "white_bold"];
    // Simple drawtext for the full caption (for word-level captions, we'd need SRT)
    const safeText = captionText.slice(0, 200).replace(/['":\\]/g, " ");
    captionFilters.push(`drawtext=text='${safeText}':${style}:x=(w-text_w)/2:y=h-100`);
  }

  const allFilters = [cropFilter, ...captionFilters].join(",");
  args.push("-vf", allFilters);
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "23");
  args.push("-c:a", "aac", "-b:a", "128k");
  args.push("-movflags", "+faststart");
  args.push("output.mp4");

  return args;
}

function buildCompilationFfmpegArgs(
  clips: Array<{ start: number; end: number }>,
  aspectRatio: string,
  addFades: boolean,
): string[] {
  const N = clips.length;
  const cropFilter = aspectRatio === "9:16"
    ? "crop=ih*9/16:ih,scale=1080:1920,setsar=1"
    : aspectRatio === "1:1"
    ? "crop=ih:ih,scale=1080:1080,setsar=1"
    : "scale=1920:1080,setsar=1";

  const parts: string[] = [];
  // Split input into N independent copies
  parts.push(`[0:v]split=${N}${Array.from({ length: N }, (_, i) => `[sv${i}]`).join("")}`);
  parts.push(`[0:a]asplit=${N}${Array.from({ length: N }, (_, i) => `[sa${i}]`).join("")}`);

  for (let i = 0; i < N; i++) {
    const { start, end } = clips[i];
    const dur = end - start;
    let vFilter = `[sv${i}]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,${cropFilter}`;
    let aFilter = `[sa${i}]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS`;
    if (addFades && dur > 1) {
      const fadeOut = Math.max(0.01, dur - 0.4).toFixed(2);
      vFilter += `,fade=t=in:st=0:d=0.3,fade=t=out:st=${fadeOut}:d=0.3`;
      aFilter += `,afade=t=in:st=0:d=0.3,afade=t=out:st=${fadeOut}:d=0.3`;
    }
    parts.push(`${vFilter}[v${i}]`);
    parts.push(`${aFilter}[a${i}]`);
  }

  const concatInputs = Array.from({ length: N }, (_, i) => `[v${i}][a${i}]`).join("");
  parts.push(`${concatInputs}concat=n=${N}:v=1:a=1[outv][outa]`);

  return [
    "-i", "input.mp4",
    "-filter_complex", parts.join(";"),
    "-map", "[outv]",
    "-map", "[outa]",
    "-c:v", "libx264", "-preset", "fast", "-crf", "22",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    "output.mp4",
  ];
}

async function submitFfmpegJob(inputUrl: string, ffmpegArgs: string[]): Promise<{ request_id: string }> {
  const endpoint = "https://queue.fal.run/fal-ai/ffmpeg-api";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      commands: ffmpegArgs,
      files: [{ url: inputUrl, filename: "input.mp4" }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const err = await res.text();
    // fal.ai ffmpeg-api might not exist — fall back to returning the FFmpeg command
    throw new Error(`fal_ffmpeg_unavailable: ${err.slice(0, 100)}`);
  }

  const data = await res.json();
  return { request_id: data.request_id };
}

// ── Gemini thumbnail helper ────────────────────────────────

async function extractThumbnailTimestamp(videoUrl: string, clipStart: number, clipEnd: number): Promise<number> {
  // Ask Gemini to identify the best frame for a thumbnail
  const prompt = `Given a video clip from ${clipStart}s to ${clipEnd}s, what timestamp (in seconds) would make the best thumbnail? Consider: peak expression, action moment, surprising visual. Return ONLY a single number (the timestamp).`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [
          { text: prompt },
          { fileData: { mimeType: "video/mp4", fileUri: videoUrl } },
        ]}],
        generationConfig: { temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!res.ok) return (clipStart + clipEnd) / 2; // midpoint fallback
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const ts = parseFloat(text.trim());
  return isNaN(ts) ? (clipStart + clipEnd) / 2 : ts;
}

// ── Action handlers ────────────────────────────────────────

async function handleRender(action: RenderAction, supabase: ReturnType<typeof createClient>) {
  const {
    user_id: userId,
    clip_id: clipId,
    source_url: sourceUrl,
    start_seconds: startSeconds,
    end_seconds: endSeconds,
    aspect_ratio: aspectRatio = "9:16",
    add_captions: addCaptions = false,
    caption_style: captionStyle,
    caption_text: captionText,
  } = action;

  const ffmpegArgs = buildFfmpegArgs(
    startSeconds,
    endSeconds,
    aspectRatio,
    addCaptions,
    captionText,
    captionStyle,
  );

  let jobId: string | null = null;
  let status = "rendering";
  let ffmpegCmd: string | null = null;
  let renderUrl: string | null = null;

  try {
    // Try to submit to fal.ai ffmpeg-api
    const { request_id } = await submitFfmpegJob(sourceUrl, ffmpegArgs);

    // Insert render job record
    const { data: jobRow, error: jobErr } = await supabase
      .from("video_render_jobs")
      .insert({
        clip_id: clipId,
        user_id: userId,
        provider: "fal",
        provider_job_id: request_id,
        status: "rendering",
        ffmpeg_args: ffmpegArgs,
      })
      .select("id")
      .single();

    if (jobErr) throw jobErr;
    jobId = jobRow.id;

    // Update clip render status
    await supabase
      .from("video_clips")
      .update({ render_status: "rendering" })
      .eq("id", clipId);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.startsWith("fal_ffmpeg_unavailable")) {
      // fal.ai not configured — return clip info so the frontend can offer a
      // direct download of the source video with timestamp guidance.
      const ffmpegCmdStr = `ffmpeg -i "INPUT_VIDEO_PATH" -ss ${startSeconds} -t ${endSeconds - startSeconds} ${ffmpegArgs.slice(ffmpegArgs.indexOf("-vf")).join(" ")}`;

      // Mark clip as "manual" so UI shows the timestamp-download flow
      await supabase
        .from("video_clips")
        .update({ render_status: "manual" })
        .eq("id", clipId);

      status = "manual";
      ffmpegCmd = ffmpegCmdStr;
      renderUrl = sourceUrl; // direct link to source video
    } else {
      // Unexpected error — rethrow
      throw err;
    }
  }

  return {
    job_id: jobId,
    status,
    clip_id: clipId,
    ffmpeg_cmd: ffmpegCmd,
    render_url: renderUrl,
  };
}

async function handlePoll(action: PollAction, supabase: ReturnType<typeof createClient>) {
  const { job_id: jobId, user_id: userId } = action;

  // Load render job from DB
  const { data: job, error: jobErr } = await supabase
    .from("video_render_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (jobErr || !job) {
    throw new Error(`Render job not found: ${jobId}`);
  }

  // Only poll fal.ai if the job has a provider job ID
  if (job.provider === "fal" && job.provider_job_id) {
    const pollUrl = `https://queue.fal.run/fal-ai/ffmpeg-api/requests/${job.provider_job_id}`;
    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: `Key ${FAL_KEY}` },
      signal: AbortSignal.timeout(15000),
    });

    if (!pollRes.ok) {
      return { status: job.status, clip_id: job.clip_id, job_id: jobId };
    }

    const pollData = await pollRes.json();
    const falStatus: string = pollData.status ?? "";

    if (falStatus === "COMPLETED") {
      // Extract output URL
      const outputUrl: string =
        pollData.output?.url ??
        pollData.output?.video?.url ??
        pollData.output?.files?.[0]?.url ??
        "";

      // Update clip
      await supabase
        .from("video_clips")
        .update({ render_url: outputUrl, render_status: "ready" })
        .eq("id", job.clip_id);

      // Update job
      await supabase
        .from("video_render_jobs")
        .update({ status: "ready", render_url: outputUrl, completed_at: new Date().toISOString() })
        .eq("id", jobId);

      return { status: "ready", render_url: outputUrl, clip_id: job.clip_id, job_id: jobId };
    }

    if (falStatus === "FAILED" || falStatus === "CANCELLED") {
      await supabase
        .from("video_render_jobs")
        .update({ status: "failed", completed_at: new Date().toISOString() })
        .eq("id", jobId);

      await supabase
        .from("video_clips")
        .update({ render_status: "failed" })
        .eq("id", job.clip_id);

      return { status: "failed", clip_id: job.clip_id, job_id: jobId };
    }

    // Still in progress
    return { status: "rendering", clip_id: job.clip_id, job_id: jobId };
  }

  // Non-fal job or no provider_job_id — just return current DB status
  return { status: job.status, render_url: job.render_url ?? undefined, clip_id: job.clip_id, job_id: jobId };
}

async function handleExtractThumbnail(action: ExtractThumbnailAction, supabase: ReturnType<typeof createClient>) {
  const {
    source_url: sourceUrl,
    timestamp_seconds: timestampSeconds,
    user_id: userId,
    clip_id: clipId,
  } = action;

  // Determine clip bounds around the given timestamp for Gemini context
  const clipStart = Math.max(0, timestampSeconds - 30);
  const clipEnd = timestampSeconds + 30;

  // Use Gemini to identify the best thumbnail timestamp
  const bestTimestamp = await extractThumbnailTimestamp(sourceUrl, clipStart, clipEnd);

  // Attempt FFmpeg thumbnail extraction via fal.ai
  let thumbnailUrl: string | null = null;
  let extractionMethod = "gemini_recommendation";

  try {
    const ffmpegArgs = [
      "-i", "input.mp4",
      "-ss", String(bestTimestamp),
      "-vframes", "1",
      "-q:v", "2",
      "thumbnail.jpg",
    ];

    const { request_id } = await submitFfmpegJob(sourceUrl, ffmpegArgs);

    // Poll briefly (up to 3 attempts, 2s apart) for quick thumbnail extraction
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise((r) => setTimeout(r, 2000));
      const pollRes = await fetch(
        `https://queue.fal.run/fal-ai/ffmpeg-api/requests/${request_id}`,
        { headers: { Authorization: `Key ${FAL_KEY}` }, signal: AbortSignal.timeout(10000) }
      );
      if (pollRes.ok) {
        const pollData = await pollRes.json();
        if (pollData.status === "COMPLETED") {
          thumbnailUrl =
            pollData.output?.url ??
            pollData.output?.image?.url ??
            pollData.output?.files?.[0]?.url ??
            null;
          extractionMethod = "fal_ffmpeg";
          break;
        }
      }
    }
  } catch (_err) {
    // fal.ai unavailable — fall through with gemini recommendation only
  }

  // If we have a clip_id, update its thumbnail metadata
  if (clipId) {
    const updatePayload: Record<string, unknown> = {
      thumbnail_timestamp: bestTimestamp,
    };
    if (thumbnailUrl) {
      updatePayload.thumbnail_url = thumbnailUrl;
    }
    await supabase.from("video_clips").update(updatePayload).eq("id", clipId);
  }

  return {
    best_timestamp: bestTimestamp,
    thumbnail_url: thumbnailUrl,
    extraction_method: extractionMethod,
    clip_id: clipId ?? null,
  };
}

async function handleCompile(action: CompileAction, supabase: ReturnType<typeof createClient>) {
  const {
    user_id: userId,
    source_url: sourceUrl,
    clips,
    aspect_ratio: aspectRatio = "9:16",
    add_fades: addFades = true,
  } = action;

  if (!clips || clips.length < 2) {
    throw new Error("At least 2 clips are required to build a compilation.");
  }
  if (clips.length > 12) {
    throw new Error("Maximum 12 clips per compilation.");
  }

  // Sort clips chronologically
  const sorted = [...clips].sort((a, b) => a.start - b.start);

  const ffmpegArgs = buildCompilationFfmpegArgs(sorted, aspectRatio, addFades);

  let jobId: string | null = null;
  let status = "rendering";
  let ffmpegCmd: string | null = null;
  let renderUrl: string | null = null;

  try {
    const { request_id } = await submitFfmpegJob(sourceUrl, ffmpegArgs);

    const { data: jobRow, error: jobErr } = await supabase
      .from("video_render_jobs")
      .insert({
        user_id: userId,
        provider: "fal",
        provider_job_id: request_id,
        status: "rendering",
        ffmpeg_args: ffmpegArgs,
      })
      .select("id")
      .single();

    if (jobErr) throw jobErr;
    jobId = jobRow.id;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("fal_ffmpeg_unavailable")) {
      // Build a manual ffmpeg command showing the filter
      const times = sorted.map((c, i) =>
        `  # Clip ${i + 1}: ${(c as any).title ?? "clip"} (${c.start}s → ${c.end}s)`
      ).join("\n");
      ffmpegCmd = `# Compilation — ${sorted.length} clips\n${times}\nffmpeg -i "INPUT_VIDEO_PATH" -filter_complex "${ffmpegArgs[ffmpegArgs.indexOf("-filter_complex") + 1]}" -map "[outv]" -map "[outa]" -c:v libx264 -preset fast -crf 22 -c:a aac -b:a 128k -movflags +faststart compilation.mp4`;
      status = "manual";
      renderUrl = sourceUrl;
    } else {
      throw err;
    }
  }

  return { job_id: jobId, status, ffmpeg_cmd: ffmpegCmd, render_url: renderUrl };
}

// ── Main handler ───────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const body = (await req.json()) as VideoRenderAction;

    let result: unknown;

    switch (body.action) {
      case "render":
        result = await handleRender(body as RenderAction, supabase);
        break;

      case "poll":
        result = await handlePoll(body as PollAction, supabase);
        break;

      case "extract_thumbnail":
        result = await handleExtractThumbnail(body as ExtractThumbnailAction, supabase);
        break;

      case "compile":
        result = await handleCompile(body as CompileAction, supabase);
        break;

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${(body as VideoRenderAction & { action: string }).action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-video-render] error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
