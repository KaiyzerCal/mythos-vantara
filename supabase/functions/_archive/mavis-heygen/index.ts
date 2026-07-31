// MAVIS HeyGen
// Creates AI avatar talking-head videos via the HeyGen API.
// Supports create, poll, and list_avatars actions.
//
// POST { action: "create", script: string, avatar_id?: string, voice_id?: string, title?: string }
// POST { action: "poll",   video_id: string }
// POST { action: "list_avatars" }
//
// Env vars: HEYGEN_API_KEY

const HEYGEN_KEY  = Deno.env.get("HEYGEN_API_KEY") ?? "";
const HEYGEN_BASE = "https://api.heygen.com";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}

function heygenHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Api-Key": HEYGEN_KEY,
  };
}

// ── HeyGen actions ────────────────────────────────────────────────────────────

async function createVideo(
  script: string,
  avatarId: string,
  voiceId: string,
  title: string,
): Promise<{ video_id: string; status: string }> {
  const res = await fetch(`${HEYGEN_BASE}/v2/video/generate`, {
    method: "POST",
    headers: heygenHeaders(),
    body: JSON.stringify({
      title,
      video_inputs: [
        {
          character: {
            type: "avatar",
            avatar_id: avatarId,
            avatar_style: "normal",
          },
          voice: {
            type: "text",
            input_text: script,
            voice_id: voiceId,
          },
          background: {
            type: "color",
            value: "#ffffff",
          },
        },
      ],
      dimension: { width: 1080, height: 1920 },   // 9:16 for TikTok / Reels
      aspect_ratio: "9:16",
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HeyGen generate ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const videoId = data.data?.video_id ?? data.video_id;
  if (!videoId) throw new Error("HeyGen returned no video_id: " + JSON.stringify(data));

  return { video_id: videoId, status: "processing" };
}

async function pollVideo(videoId: string): Promise<{
  status: "processing" | "complete" | "failed";
  video_url?: string;
  thumbnail_url?: string;
  duration?: number;
  error?: string;
}> {
  const res = await fetch(
    `${HEYGEN_BASE}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
    { headers: heygenHeaders(), signal: AbortSignal.timeout(15000) },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HeyGen poll ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const d = data.data ?? data;

  if (d.status === "completed") {
    return {
      status: "complete",
      video_url: d.video_url,
      thumbnail_url: d.thumbnail_url,
      duration: d.duration,
    };
  }
  if (d.status === "failed") {
    return { status: "failed", error: d.error ?? "HeyGen job failed" };
  }
  return { status: "processing" };
}

async function listAvatars(): Promise<{ avatars: unknown[] }> {
  const res = await fetch(`${HEYGEN_BASE}/v2/avatars`, {
    headers: heygenHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HeyGen list_avatars ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return { avatars: data.data?.avatars ?? data.avatars ?? [] };
}

// ── Handler ───────────────────────────────────────────────────────────────────

// Default avatar/voice — the operator can override these per request
const DEFAULT_AVATAR = "Daisy-inskirt-20220818";   // publicly available HeyGen avatar
const DEFAULT_VOICE  = "2d5b0e6cf36f460aa7fc47e3eee4ba54";  // English female

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  if (!HEYGEN_KEY) {
    return json({
      error: "HeyGen not configured",
      setup: "Add HEYGEN_API_KEY in Supabase secrets (Settings → Edge Functions → Secrets)",
    }, 503);
  }

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const action = String(body.action ?? "create");

  try {
    if (action === "list_avatars") {
      return json(await listAvatars());
    }

    if (action === "poll") {
      const videoId = String(body.video_id ?? "");
      if (!videoId) return json({ error: "video_id required for poll" }, 400);
      return json(await pollVideo(videoId));
    }

    // create (default)
    const script   = String(body.script ?? "").trim();
    if (!script) return json({ error: "script is required" }, 400);

    const avatarId = String(body.avatar_id ?? DEFAULT_AVATAR);
    const voiceId  = String(body.voice_id  ?? DEFAULT_VOICE);
    const title    = String(body.title ?? `MAVIS Social Video ${new Date().toISOString().slice(0, 10)}`);

    return json(await createVideo(script, avatarId, voiceId, title));
  } catch (err: any) {
    console.error("mavis-heygen error:", err.message);
    return json({ error: err.message }, 500);
  }
});
