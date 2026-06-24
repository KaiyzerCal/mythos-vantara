// MAVIS Blotato
// Unified social publishing via Blotato API.
// Publishes text + optional image/video to any combination of platforms in one call.
//
// POST { platforms: string[], content: string, image_url?: string, video_url?: string }
// Platforms: "facebook" | "linkedin" | "instagram" | "twitter" | "threads" | "tiktok"
//
// Env vars: BLOTATO_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const BLOTATO_API_KEY = Deno.env.get("BLOTATO_API_KEY") ?? "";
const BLOTATO_BASE    = "https://backend.blotato.com/v2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}

type Platform = "facebook" | "linkedin" | "instagram" | "twitter" | "threads" | "tiktok";

interface PublishRequest {
  platforms: Platform[];
  content: string;
  image_url?: string;
  video_url?: string;
  title?: string;
  scheduled_at?: string;   // ISO string — omit to post immediately
}

interface PlatformResult {
  platform: Platform;
  success: boolean;
  post_id?: string;
  url?: string;
  error?: string;
}

// ── Blotato publish ───────────────────────────────────────────────────────────

async function publishToBlotato(req: PublishRequest): Promise<PlatformResult[]> {
  if (!BLOTATO_API_KEY) throw new Error("BLOTATO_API_KEY not configured");

  const results: PlatformResult[] = [];

  // Blotato accepts one platform per request; fan out in parallel
  await Promise.all(
    req.platforms.map(async (platform) => {
      try {
        const payload: Record<string, unknown> = {
          platform,
          content: req.content,
        };

        if (req.image_url)    payload.image_url    = req.image_url;
        if (req.video_url)    payload.video_url    = req.video_url;
        if (req.title)        payload.title        = req.title;
        if (req.scheduled_at) payload.scheduled_at = req.scheduled_at;

        const res = await fetch(`${BLOTATO_BASE}/posts`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": BLOTATO_API_KEY,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30000),
        });

        const data = await res.json().catch(() => ({})) as Record<string, any>;

        if (res.ok && (data.success !== false)) {
          results.push({
            platform,
            success: true,
            post_id: data.post_id ?? data.id ?? data.data?.id,
            url: data.url ?? data.post_url ?? data.data?.url,
          });
        } else {
          results.push({
            platform,
            success: false,
            error: data.error ?? data.message ?? `HTTP ${res.status}`,
          });
        }
      } catch (err: any) {
        results.push({ platform, success: false, error: err.message });
      }
    })
  );

  return results;
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: PublishRequest;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { platforms, content } = body;

  if (!platforms?.length)  return json({ error: "platforms array is required" }, 400);
  if (!content?.trim())    return json({ error: "content is required" }, 400);

  const validPlatforms: Platform[] = ["facebook", "linkedin", "instagram", "twitter", "threads", "tiktok"];
  const invalid = platforms.filter(p => !validPlatforms.includes(p));
  if (invalid.length) return json({ error: `Unknown platforms: ${invalid.join(", ")}` }, 400);

  if (!BLOTATO_API_KEY) {
    return json({
      error: "Blotato not configured",
      setup: "Add BLOTATO_API_KEY in Supabase secrets (Settings → Edge Functions → Secrets)",
      platforms: platforms.map(p => ({ platform: p, success: false, error: "BLOTATO_API_KEY not set" })),
    }, 503);
  }

  try {
    const results = await publishToBlotato(body);
    const allOk = results.every(r => r.success);
    const anyOk = results.some(r => r.success);

    return json({
      success: allOk,
      partial: !allOk && anyOk,
      published: results.filter(r => r.success).map(r => r.platform),
      failed:    results.filter(r => !r.success).map(r => r.platform),
      results,
    });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
});
