// mavis-poster-gen — Marketing poster, flyer, social graphic, and banner generator
//
// Outputs per request:
//   image_url  — Ideogram V2 AI image via fal.ai (requires FAL_API_KEY)
//   html       — Pixel-perfect self-contained HTML/CSS layout (open in browser → screenshot)
//   html_url   — Public URL if stored in Supabase Storage (bucket: mavis-assets)
//
// Supported platforms: instagram_post, instagram_story, tiktok, twitter_post,
//   linkedin_post, facebook_post, flyer_portrait, poster_portrait, banner
//
// Body: { brief?, brand_name?, headline?, body_copy?, cta?, colors?, style?,
//         platform?, format_type?, user_id? }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const FAL_KEY       = Deno.env.get("FAL_API_KEY") ?? "";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Platform specs ────────────────────────────────────────────────────────────

const PLATFORMS: Record<string, {
  width: number; height: number; label: string;
  ideogram_ratio: string; font_scale: number;
}> = {
  instagram_post:  { width: 1080, height: 1080, label: "Instagram Post",   ideogram_ratio: "ASPECT_1_1",   font_scale: 1.0 },
  instagram_story: { width: 1080, height: 1920, label: "Instagram Story",  ideogram_ratio: "ASPECT_9_16",  font_scale: 1.1 },
  tiktok:          { width: 1080, height: 1920, label: "TikTok",           ideogram_ratio: "ASPECT_9_16",  font_scale: 1.1 },
  twitter_post:    { width: 1200, height: 675,  label: "Twitter/X Post",   ideogram_ratio: "ASPECT_16_9",  font_scale: 0.85 },
  linkedin_post:   { width: 1200, height: 628,  label: "LinkedIn Post",    ideogram_ratio: "ASPECT_16_9",  font_scale: 0.85 },
  facebook_post:   { width: 1200, height: 630,  label: "Facebook Post",    ideogram_ratio: "ASPECT_16_9",  font_scale: 0.85 },
  flyer_portrait:  { width: 794,  height: 1123, label: "Flyer / A4",       ideogram_ratio: "ASPECT_3_4",   font_scale: 0.9 },
  poster_portrait: { width: 600,  height: 900,  label: "Portrait Poster",  ideogram_ratio: "ASPECT_2_3",   font_scale: 0.85 },
  banner:          { width: 1200, height: 400,  label: "Wide Banner",      ideogram_ratio: "ASPECT_3_1",   font_scale: 0.75 },
};

// ── Step 1: Parse natural language brief via Claude ───────────────────────────

interface PosterFields {
  brand_name: string;
  headline: string;
  sub_headline?: string;
  body_copy?: string;
  cta?: string;
  colors?: string;
  style?: string;
  platform: string;
  format_type: string;
}

async function parseBrief(brief: string, platform: string): Promise<PosterFields> {
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
      messages: [{
        role: "user",
        content: `Extract design fields from this poster brief. Return ONLY valid JSON, no markdown.\n\nBrief: "${brief}"\n\nReturn:\n{"brand_name":"...","headline":"...","sub_headline":"...or null","body_copy":"...or null","cta":"...or null","colors":"...or null","style":"...or null","format_type":"poster or flyer or social graphic or banner"}`,
      }],
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Claude parse failed: ${res.status}`);
  const data = await res.json();
  const text: string = data.content?.[0]?.text ?? "{}";

  try {
    const parsed = JSON.parse(text.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim());
    return {
      brand_name:   parsed.brand_name  ?? "My Brand",
      headline:     parsed.headline    ?? brief.slice(0, 60),
      sub_headline: parsed.sub_headline ?? undefined,
      body_copy:    parsed.body_copy   ?? undefined,
      cta:          parsed.cta         ?? undefined,
      colors:       parsed.colors      ?? undefined,
      style:        parsed.style       ?? "modern premium",
      platform,
      format_type:  parsed.format_type ?? "social graphic",
    };
  } catch {
    return { brand_name: "My Brand", headline: brief.slice(0, 80), style: "modern premium", platform, format_type: "poster" };
  }
}

// ── Step 2: Generate HTML/CSS poster layout via Claude ────────────────────────

async function generateHTML(fields: PosterFields, specs: typeof PLATFORMS[string]): Promise<string> {
  const { width, height, label, font_scale } = specs;

  const systemPrompt = `You are an elite graphic designer AI. Generate stunning, production-ready HTML/CSS marketing materials. Your designs should look like they came from a top agency — bold typography, strong visual hierarchy, premium feel. Always output ONLY raw HTML starting with <!DOCTYPE html>. No explanations.`;

  const userPrompt = `Design a ${label} (EXACTLY ${width}px × ${height}px) for this brief:

BRAND: ${fields.brand_name}
HEADLINE: ${fields.headline}
${fields.sub_headline ? `SUB-HEADLINE: ${fields.sub_headline}` : ""}
${fields.body_copy ? `BODY: ${fields.body_copy}` : ""}
${fields.cta ? `CTA BUTTON: ${fields.cta}` : ""}
COLOR PALETTE: ${fields.colors ?? "choose premium colors that fit the brand"}
VISUAL STYLE: ${fields.style ?? "modern, premium, bold"}
FORMAT: ${fields.format_type}

HTML REQUIREMENTS:
- ONLY valid HTML. Start with <!DOCTYPE html>. No markdown, no backticks.
- Body and wrapper must be EXACTLY ${width}px × ${height}px. Use overflow:hidden on body.
- @import Google Fonts at top of <style> for premium typography (Bebas Neue, Montserrat, Inter, Space Grotesk, etc.)
- ALL CSS must be inline in a <style> tag — zero external stylesheets except Google Fonts @import
- Background: use rich CSS gradients, not flat colors. Add depth.
- Visual elements: use CSS ::before/::after for geometric accents, diagonal cuts, glows, or abstract shapes
- Typography: big, bold headline. Proper hierarchy. Font sizes scaled for ${width}px width (base scale: ${font_scale}x)
- CTA button (if provided): styled as a premium button with hover state (CSS :hover)
- Add subtle CSS animations: fade-in, slide-up, or glow pulse on the headline (use @keyframes)
- Bottom 10%: brand name / logo area, smaller text
- NO placeholder images. Use only CSS shapes, gradients, and text.
- Make it look like a real, professional ${fields.format_type} — not a webpage.

Output ONLY the complete HTML file.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
    signal: AbortSignal.timeout(45000),
  });

  if (!res.ok) throw new Error(`Claude HTML generation failed: ${res.status}`);
  const data = await res.json();
  let html: string = data.content?.[0]?.text ?? "";
  html = html.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
  if (!html.startsWith("<!DOCTYPE") && !html.startsWith("<html")) {
    throw new Error("Claude did not return valid HTML");
  }
  return html;
}

// ── Step 3: Generate AI image via Ideogram V2 on fal.ai ──────────────────────

async function generateIdeogramImage(
  fields: PosterFields,
  ideogramRatio: string,
): Promise<string | null> {
  if (!FAL_KEY) return null;

  const styleType = (fields.style ?? "").toLowerCase().includes("photo") ? "REALISTIC"
    : (fields.style ?? "").toLowerCase().includes("3d") ? "RENDER_3D"
    : "DESIGN";

  const prompt = [
    `${fields.format_type ?? "marketing poster"} for ${fields.brand_name}.`,
    `Bold headline text: "${fields.headline}".`,
    fields.sub_headline ? `Subtext: "${fields.sub_headline}".` : "",
    fields.cta          ? `Call to action: "${fields.cta}".` : "",
    fields.colors       ? `Color scheme: ${fields.colors}.` : "",
    fields.style        ? `Style: ${fields.style}.` : "Modern, premium design.",
    "Professional marketing material. Clean typography. High visual impact. Award-winning design.",
  ].filter(Boolean).join(" ");

  try {
    const res = await fetch("https://fal.run/fal-ai/ideogram/v2", {
      method: "POST",
      headers: { "Authorization": `Key ${FAL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        aspect_ratio: ideogramRatio,
        style_type: styleType,
        magic_prompt_option: "AUTO",
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) {
      console.error(`Ideogram failed: ${res.status} ${await res.text()}`);
      return null;
    }
    const data = await res.json();
    return data?.images?.[0]?.url ?? null;
  } catch (err) {
    console.error("Ideogram error:", err);
    return null;
  }
}

// ── Step 4: Store HTML in Supabase Storage ────────────────────────────────────

async function storeHTML(html: string, userId: string, platform: string): Promise<string | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const filename = `posters/${userId}/${Date.now()}-${platform}.html`;
    const { error } = await supabase.storage
      .from("mavis-assets")
      .upload(filename, html, { contentType: "text/html; charset=utf-8", upsert: true });
    if (error) return null;
    const { data: urlData } = supabase.storage.from("mavis-assets").getPublicUrl(filename);
    return urlData?.publicUrl ?? null;
  } catch {
    return null;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();

    // If brief is provided, parse it; otherwise use structured fields
    const platform: string = body.platform ?? "instagram_post";
    const specs = PLATFORMS[platform] ?? PLATFORMS.instagram_post;

    let fields: PosterFields;
    if (body.brief?.trim()) {
      if (!ANTHROPIC_KEY) {
        return json({ error: "ANTHROPIC_API_KEY required for brief parsing" }, 503);
      }
      fields = await parseBrief(body.brief, platform);
      // Allow structured overrides on top of parsed brief
      if (body.brand_name) fields.brand_name = body.brand_name;
      if (body.headline)   fields.headline   = body.headline;
      if (body.cta)        fields.cta        = body.cta;
      if (body.colors)     fields.colors     = body.colors;
      if (body.style)      fields.style      = body.style;
    } else {
      if (!body.brand_name?.trim() || !body.headline?.trim()) {
        return json({ error: "Provide either 'brief' (natural language) or 'brand_name' + 'headline'" }, 400);
      }
      fields = {
        brand_name:  body.brand_name,
        headline:    body.headline,
        sub_headline: body.sub_headline,
        body_copy:   body.body_copy,
        cta:         body.cta,
        colors:      body.colors,
        style:       body.style ?? "modern premium",
        platform,
        format_type: body.format_type ?? "social graphic",
      };
    }

    // Run HTML and image generation in parallel
    const [html, imageUrl] = await Promise.all([
      ANTHROPIC_KEY ? generateHTML(fields, specs).catch(err => { console.error(err); return null; }) : null,
      generateIdeogramImage(fields, specs.ideogram_ratio),
    ]);

    // Store HTML in Supabase Storage (non-blocking)
    const htmlUrl = (html && body.user_id)
      ? await storeHTML(html, String(body.user_id), platform)
      : null;

    return json({
      ok: true,
      platform,
      platform_label: specs.label,
      dimensions: { width: specs.width, height: specs.height },
      image_url: imageUrl,
      html_url: htmlUrl,
      html,
      fields: {
        brand:    fields.brand_name,
        headline: fields.headline,
        cta:      fields.cta ?? null,
        style:    fields.style ?? null,
        colors:   fields.colors ?? null,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("mavis-poster-gen error:", msg);
    return json({ error: msg }, 500);
  }
});
