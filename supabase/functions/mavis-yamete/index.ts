// mavis-yamete
// MAVIS integration for yamete.gg — NSFW AI image generation and roleplay chat.
// Routes generation requests to yamete.gg's API, uploads output images to
// Supabase Storage (bucket: mavis-generated), and returns a 1-hour signed URL.
//
// Required env vars:
//   YAMETE_API_KEY             — API key / bearer token from yamete.gg account
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Optional env vars:
//   YAMETE_BASE_URL            — defaults to "https://yamete.gg"
//                                Override if yamete.gg exposes a separate API subdomain.
//
// NOTE: yamete.gg does not publish a developer API as of July 2026.
// The endpoints below are based on common REST patterns for AI generation platforms.
// To activate this integration:
// 1. Contact yamete.gg for API access or check their settings/developer page for an API key.
// 2. Set YAMETE_API_KEY in Supabase secrets.
// 3. Adjust YAMETE_BASE_URL and endpoint paths below if their actual API differs.
// Once configured, MAVIS will route NSFW generation requests here instead of ComfyUI.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Env vars ──────────────────────────────────────────────────────────────────

const YAMETE_API_KEY  = Deno.env.get("YAMETE_API_KEY") ?? "";
const YAMETE_BASE_URL = (Deno.env.get("YAMETE_BASE_URL") ?? "https://yamete.gg").replace(/\/$/, "");
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const YAMETE_CONFIGURED = Boolean(YAMETE_API_KEY);

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// ── CORS ──────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

// ── Types ─────────────────────────────────────────────────────────────────────

type GenerateAction =
  | "generate_image"
  | "generate_realistic"
  | "generate_hentai"
  | "generate_furry";

type Action = GenerateAction | "chat" | "check_status";

interface RequestBody {
  action: Action;
  prompt?: string;
  negative_prompt?: string;
  style?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  seed?: number;
  character_id?: string;
  message?: string;
  language?: string;
  user_id?: string;
}

// ── yamete.gg API helper ──────────────────────────────────────────────────────

async function yamapiRequest(
  path: string,
  payload: Record<string, unknown>,
  method: "POST" | "GET" = "POST",
): Promise<Record<string, unknown>> {
  const url = `${YAMETE_BASE_URL}/api${path}`;
  const options: RequestInit = {
    method,
    headers: {
      "Authorization": `Bearer ${YAMETE_API_KEY}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(120_000),
  };
  if (method === "POST") {
    options.body = JSON.stringify(payload);
  }
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`yamete.gg ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return await res.json() as Record<string, unknown>;
}

// ── Style derivation ──────────────────────────────────────────────────────────

function styleFromAction(action: GenerateAction, explicitStyle?: string): string {
  if (explicitStyle) return explicitStyle;
  switch (action) {
    case "generate_realistic": return "realistic";
    case "generate_hentai":    return "hentai";
    case "generate_furry":     return "furry";
    default:                   return "anime";
  }
}

// ── Supabase Storage upload ───────────────────────────────────────────────────

async function uploadToStorage(
  bytes: Uint8Array,
  userId: string,
): Promise<string> {
  const bucket   = "mavis-generated";
  const path     = `${userId}/yamete-${Date.now()}.png`;

  // Ensure bucket exists — ignore error if it already does
  await sb.storage.createBucket(bucket, { public: false }).catch(() => {});

  const { error } = await sb.storage.from(bucket).upload(path, bytes, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data: signedData } = await sb.storage.from(bucket).createSignedUrl(path, 3600);
  if (!signedData?.signedUrl) throw new Error("Could not create signed URL");

  return signedData.signedUrl;
}

// ── Image bytes resolution ────────────────────────────────────────────────────

// yamete.gg may return either:
//   { image_url: "https://..." }   — a direct URL to the generated image
//   { image: "<base64...>" }       — raw base64-encoded PNG bytes
async function resolveBytesFromResponse(data: Record<string, unknown>): Promise<Uint8Array> {
  // Case 1: direct image URL
  const imageUrl = (data.image_url ?? data.url ?? data.output) as string | undefined;
  if (imageUrl && typeof imageUrl === "string" && imageUrl.startsWith("http")) {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Failed to fetch generated image from ${imageUrl}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  // Case 2: base64 string
  const b64 = (data.image ?? data.data ?? data.base64) as string | undefined;
  if (b64 && typeof b64 === "string") {
    // Strip optional data URI prefix: "data:image/png;base64,..."
    const raw = b64.includes(",") ? b64.split(",")[1] : b64;
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  throw new Error(
    `yamete.gg response contained neither an image URL nor base64 data. ` +
    `Keys received: ${Object.keys(data).join(", ")}`,
  );
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Guard: API key not configured
    if (!YAMETE_CONFIGURED) {
      return new Response(
        JSON.stringify({
          error: "yamete.gg integration is not configured.",
          setup: [
            "1. Obtain an API key from yamete.gg (check their settings or developer page).",
            "2. Set YAMETE_API_KEY in Supabase secrets (Dashboard → Edge Functions → Secrets).",
            "3. Optionally set YAMETE_BASE_URL if they use a separate API subdomain.",
            "4. Re-deploy this function.",
          ],
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({})) as RequestBody;
    const action   = (body.action ?? "generate_image") as Action;
    const userId   = String(body.user_id ?? "anonymous");

    // ── check_status: health check against yamete.gg API ──────────────────────

    if (action === "check_status") {
      const status = await yamapiRequest("/status", {}, "GET").catch((err) => ({
        reachable: false,
        error: err instanceof Error ? err.message : String(err),
      }));
      return new Response(
        JSON.stringify({ ok: true, yamete_status: status }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── chat ──────────────────────────────────────────────────────────────────

    if (action === "chat") {
      const characterId = body.character_id;
      const message     = String(body.message ?? "").trim();
      const language    = String(body.language ?? "en");

      if (!message) {
        return new Response(
          JSON.stringify({ error: "message is required for chat action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const data = await yamapiRequest("/chat", {
        character_id: characterId,
        message,
        language,
      });

      return new Response(
        JSON.stringify({ ok: true, action, ...data }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── image generation ──────────────────────────────────────────────────────

    const generateActions: GenerateAction[] = [
      "generate_image",
      "generate_realistic",
      "generate_hentai",
      "generate_furry",
    ];

    if (!generateActions.includes(action as GenerateAction)) {
      return new Response(
        JSON.stringify({ error: `Unknown action: ${action}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const prompt         = String(body.prompt ?? "").trim();
    const negativePrompt = body.negative_prompt ?? "";
    const style          = styleFromAction(action as GenerateAction, body.style);
    const width          = Number(body.width)  || 512;
    const height         = Number(body.height) || 768;
    const steps          = Number(body.steps)  || 25;
    const cfg            = Number(body.cfg)    || 7;
    const seed           = body.seed !== undefined ? Number(body.seed) : undefined;

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "prompt is required for image generation" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const generatePayload: Record<string, unknown> = {
      prompt,
      negative_prompt: negativePrompt,
      style,
      width,
      height,
      steps,
      cfg,
    };
    if (seed !== undefined) generatePayload.seed = seed;

    const data = await yamapiRequest("/generate", generatePayload);

    // Resolve image bytes — handles URL or base64 response
    const bytes     = await resolveBytesFromResponse(data);
    const signedUrl = await uploadToStorage(bytes, userId);

    return new Response(
      JSON.stringify({
        ok:       true,
        action,
        style,
        imageUrl: signedUrl,
        // Pass through any extra metadata yamete.gg returns (generation_id, etc.)
        meta: Object.fromEntries(
          Object.entries(data).filter(
            ([k]) => !["image_url", "url", "output", "image", "data", "base64"].includes(k),
          ),
        ),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[mavis-yamete]", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
