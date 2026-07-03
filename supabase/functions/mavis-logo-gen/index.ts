// mavis-logo-gen — Brand logo and icon generation
//
// Providers (via FAL_API_KEY):
//   recraft-v3    — Recraft V3 (primary): vector-quality brand design, logos, icons (~$0.04/img)
//   flux-pro      — FLUX 1.1 Pro (fallback): high-quality general image generation
//
// POST body:
//   brand_name    string   — the brand or product name
//   description   string   — what the brand does / its vibe
//   style         string   — "minimal" | "bold" | "tech" | "luxury" | "playful" | "corporate"
//   colors        string   — color preferences
//   logo_type     string   — "lettermark" | "wordmark" | "icon" | "combination" | "emblem" (default: icon)
//   format        string   — "square" | "wide" | "tall" (default: square)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FAL_KEY = Deno.env.get("FAL_API_KEY") ?? "";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const RECRAFT_STYLES: Record<string, string> = {
  minimal:    "vector_illustration",
  bold:       "vector_illustration/bold_stroke",
  tech:       "digital_illustration/pixel_art",
  luxury:     "realistic_image/enterprise",
  playful:    "vector_illustration/cartoon",
  corporate:  "vector_illustration/flat_2",
  default:    "vector_illustration",
};

const FORMAT_SIZES: Record<string, string> = {
  square: "square_hd",
  wide:   "landscape_4_3",
  tall:   "portrait_4_3",
};

function buildLogoPrompt(
  brandName: string,
  description: string,
  style: string,
  colors: string,
  logoType: string,
): string {
  const typeDescriptions: Record<string, string> = {
    lettermark:  `Single letter or initials logo for "${brandName}" — clean, iconic, memorable`,
    wordmark:    `Text-only logo with the word "${brandName}" — custom typography, distinctive letterforms`,
    icon:        `Symbol or icon logo representing "${brandName}" — works as app icon or favicon`,
    combination: `Logo with both icon/symbol AND the text "${brandName}" side by side`,
    emblem:      `Badge or emblem style logo with "${brandName}" incorporated into the shape`,
  };

  const parts = [
    typeDescriptions[logoType] ?? typeDescriptions.icon,
    `Brand: ${description}`,
    style !== "default" ? `Visual style: ${style}, professional, clean` : "Professional, clean, modern",
    colors ? `Colors: ${colors}` : "Use colors appropriate for the brand identity",
    "White or transparent background. No photographic elements. Vector-quality clean lines.",
    "Logo design for professional brand identity. Commercial use quality.",
  ];

  return parts.join(". ");
}

// ── Recraft V3 ────────────────────────────────────────────────────────────────

async function generateWithRecraft(
  prompt: string,
  recraftStyle: string,
  imageSize: string,
): Promise<string> {
  const res = await fetch("https://fal.run/fal-ai/recraft-v3", {
    method: "POST",
    headers: { "Authorization": `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, style: recraftStyle, image_size: imageSize }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Recraft V3 ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
  const data = await res.json();
  const url = data?.images?.[0]?.url ?? data?.image?.url;
  if (!url) throw new Error("Recraft V3 returned no image URL");
  return url;
}

// ── FLUX 1.1 Pro (fallback) ───────────────────────────────────────────────────

async function generateWithFluxPro(prompt: string, imageSize: string): Promise<string> {
  const res = await fetch("https://fal.run/fal-ai/flux-pro/v1.1", {
    method: "POST",
    headers: { "Authorization": `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: `${prompt}. Isolated on white background. Clean vector-style graphic.`,
      image_size: imageSize,
      num_images: 1,
      safety_tolerance: "2",
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`FLUX Pro ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
  const data = await res.json();
  const url = data?.images?.[0]?.url;
  if (!url) throw new Error("FLUX Pro returned no image URL");
  return url;
}

// ── Handler ──────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!FAL_KEY) return json({ error: "FAL_API_KEY not configured" }, 503);

  try {
    const body = await req.json();
    const brandName: string = body.brand_name?.trim() ?? "";
    const description: string = body.description?.trim() ?? "";
    if (!brandName) return json({ error: "brand_name is required" }, 400);

    const style     = (body.style     ?? "default").toLowerCase();
    const colors    = body.colors     ?? "";
    const logoType  = body.logo_type  ?? "icon";
    const format    = body.format     ?? "square";
    const provider  = body.provider   ?? "recraft";

    const prompt = buildLogoPrompt(brandName, description || brandName, style, colors, logoType);
    const recraftStyle = RECRAFT_STYLES[style] ?? RECRAFT_STYLES.default;
    const imageSize = FORMAT_SIZES[format] ?? FORMAT_SIZES.square;

    let url: string;
    let usedProvider: string;

    if (provider === "flux") {
      url = await generateWithFluxPro(prompt, imageSize);
      usedProvider = "flux-pro";
    } else {
      try {
        url = await generateWithRecraft(prompt, recraftStyle, imageSize);
        usedProvider = "recraft-v3";
      } catch (err) {
        console.warn("Recraft failed, falling back to FLUX Pro:", err);
        url = await generateWithFluxPro(prompt, imageSize);
        usedProvider = "flux-pro (fallback)";
      }
    }

    return json({
      ok: true,
      url,
      provider: usedProvider,
      prompt_used: prompt,
      brand: brandName,
      logo_type: logoType,
      style,
    });

  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
