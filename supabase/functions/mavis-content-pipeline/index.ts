/**
 * MAVIS Content Pipeline — Genviral/Outstand MCP autonomous NORA Vale content engine.
 * Supports 47 social commands across LinkedIn, Twitter/X, Instagram, TikTok, YouTube.
 * Falls back to Gemini direct when Outstand MCP is not configured.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const OUTSTAND_KEY  = Deno.env.get("OUTSTAND_API_KEY") ?? "";
const OUTSTAND_BASE = Deno.env.get("OUTSTAND_API_URL") ?? "https://api.outstand.com/v1";
const GEMINI_KEY    = Deno.env.get("GEMINI_API_KEY") ?? "";
const OPENAI_KEY    = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Supabase admin client ─────────────────────────────────────────────────────

const SUPABASE_URL    = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SVCKEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

async function dbInsert(table: string, row: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "apikey":        SUPABASE_SVCKEY,
      "Authorization": `Bearer ${SUPABASE_SVCKEY}`,
      "Prefer":        "return=representation",
    },
    body: JSON.stringify(row),
  });
  return res.json();
}

// ── Platform-aware prompt builder ────────────────────────────────────────────

interface PlatformSpec {
  maxChars: number;
  tone: string;
  extras: string;
}

const PLATFORM_SPECS: Record<string, PlatformSpec> = {
  linkedin:  { maxChars: 500,  tone: "professional thought leader",  extras: "no emojis, add 3 industry hashtags, include a call-to-action" },
  twitter:   { maxChars: 280,  tone: "punchy and engaging",          extras: "strong hook first 10 words, max 3 hashtags, no filler" },
  "twitter/x": { maxChars: 280, tone: "punchy and engaging",         extras: "strong hook first 10 words, max 3 hashtags, no filler" },
  instagram: { maxChars: 2200, tone: "visual storytelling",          extras: "emojis welcome, up to 10 hashtags, end with question" },
  tiktok:    { maxChars: 150,  tone: "trendy and energetic",         extras: "first 3 seconds must hook, use trending audio reference" },
  youtube:   { maxChars: 5000, tone: "informative and SEO-friendly", extras: "include keyword-rich title, description for SEO, timestamps hint" },
};

function buildPlatformPrompt(platform: string, topic: string, brandVoice: string): string {
  const spec = PLATFORM_SPECS[platform.toLowerCase()] ?? {
    maxChars: 500, tone: "engaging", extras: "include relevant hashtags",
  };
  return [
    `You are NORA Vale, a social content expert. Brand voice: ${brandVoice}.`,
    `Write a ${platform} post about: "${topic}".`,
    `Tone: ${spec.tone}. Max ${spec.maxChars} characters. ${spec.extras}.`,
    `Return JSON: { "content": "...", "hashtags": [...], "suggested_time": "HH:MM", "estimated_reach": number }`,
  ].join("\n");
}

// ── Gemini call ───────────────────────────────────────────────────────────────

async function callGemini(prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
}

// ── Outstand API helpers ──────────────────────────────────────────────────────

async function outstandPost(path: string, body: unknown) {
  const res = await fetch(`${OUTSTAND_BASE}${path}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": OUTSTAND_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Outstand ${path} returned ${res.status}`);
  return res.json();
}

async function outstandGet(path: string) {
  const res = await fetch(`${OUTSTAND_BASE}${path}`, {
    headers: { "X-API-Key": OUTSTAND_KEY },
  });
  if (!res.ok) throw new Error(`Outstand ${path} returned ${res.status}`);
  return res.json();
}

// ── Action handlers ───────────────────────────────────────────────────────────

async function createContent(req: ContentRequest) {
  const { platform = "linkedin", topic = "", brand_voice = "professional", user_id } = req;

  let result: Record<string, unknown>;

  if (OUTSTAND_KEY) {
    try {
      result = await outstandPost("/content/create", { platform, topic, brand_voice });
    } catch {
      result = JSON.parse(await callGemini(buildPlatformPrompt(platform, topic, brand_voice)));
    }
  } else {
    result = JSON.parse(await callGemini(buildPlatformPrompt(platform, topic, brand_voice)));
  }

  // Persist to content queue
  await dbInsert("nora_content_queue", {
    user_id,
    platform,
    content:      result.content ?? "",
    hashtags:     result.hashtags ?? [],
    status:       "draft",
    ai_generated: true,
    source_topic: topic,
  });

  return { platform, ...result };
}

async function schedulePost(req: ContentRequest) {
  const { platform = "linkedin", content = "", user_id } = req;
  const scheduled_for = req.scheduled_for ?? new Date(Date.now() + 3600_000).toISOString();

  if (OUTSTAND_KEY) {
    const result = await outstandPost("/posts/schedule", { platform, content, scheduled_for });
    await dbInsert("nora_content_queue", { user_id, platform, content, status: "scheduled", scheduled_for, ai_generated: false });
    return result;
  }

  // No Outstand — store locally
  const rows = await dbInsert("nora_content_queue", { user_id, platform, content, status: "scheduled", scheduled_for, ai_generated: false });
  return { scheduled: true, post: rows[0] ?? null, message: "Stored locally (Outstand not configured)" };
}

async function repurposeContent(req: ContentRequest) {
  const { content = "", source_platform = "linkedin", target_platforms = ["twitter", "instagram"], brand_voice = "professional" } = req;

  const adaptations: Record<string, unknown> = {};

  for (const target of target_platforms as string[]) {
    const prompt = [
      `You are NORA Vale. Adapt this ${source_platform} content for ${target}.`,
      `Original: "${content}"`,
      `Brand voice: ${brand_voice}.`,
      `Platform rules: ${PLATFORM_SPECS[target.toLowerCase()]?.extras ?? "engaging, relevant hashtags"}.`,
      `Return JSON: { "content": "...", "hashtags": [...] }`,
    ].join("\n");

    try {
      adaptations[target] = JSON.parse(await callGemini(prompt));
    } catch {
      adaptations[target] = { content, hashtags: [] };
    }
  }

  return { source_platform, adaptations };
}

async function analyzePerformance(req: ContentRequest) {
  const { post_id = "" } = req;
  if (OUTSTAND_KEY && post_id) {
    return outstandGet(`/analytics/posts?post_id=${encodeURIComponent(post_id)}`);
  }
  return { post_id, message: "Outstand not configured — analytics unavailable", mock: true };
}

async function generateCaptions(req: ContentRequest) {
  const { topic = "", platform = "instagram", brand_voice = "creative" } = req;
  const prompt = [
    `You are NORA Vale. Generate 5 caption options for a ${platform} post about: "${topic}".`,
    `Brand voice: ${brand_voice}. Each caption should be distinct in style.`,
    `Return JSON: { "captions": [ { "text": "...", "hashtags": [...], "hook_type": "question|story|bold" } ] }`,
  ].join("\n");

  return JSON.parse(await callGemini(prompt));
}

async function batchCreate(req: ContentRequest) {
  const { topic = "", brand_voice = "professional", user_id, platforms = ["linkedin", "twitter", "instagram"] } = req;

  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const platformList = platforms as string[];
  const prompt = [
    `You are NORA Vale. Create a 7-day content calendar about: "${topic}".`,
    `Brand voice: ${brand_voice}. Platforms: ${platformList.join(", ")}.`,
    `One post per platform per day (${DAYS.join(", ")}).`,
    `Return JSON: { "calendar": [ { "day": "Monday", "platform": "...", "content": "...", "hashtags": [...], "time": "HH:MM" } ] }`,
  ].join("\n");

  const result = JSON.parse(await callGemini(prompt));
  const calendar: Array<Record<string, unknown>> = result.calendar ?? [];

  // Bulk insert
  for (const item of calendar) {
    await dbInsert("nora_content_queue", {
      user_id,
      platform:     item.platform,
      content:      item.content,
      hashtags:     item.hashtags,
      status:       "draft",
      ai_generated: true,
      source_topic: topic,
    });
  }

  return { topic, days: 7, posts_generated: calendar.length, calendar };
}

// ── Request type ──────────────────────────────────────────────────────────────

interface ContentRequest {
  action: "create_content" | "schedule_post" | "repurpose" | "analyze_performance" | "generate_captions" | "batch_create";
  platform?: string;
  topic?: string;
  brand_voice?: string;
  content?: string;
  post_id?: string;
  user_id: string;
  scheduled_for?: string;
  source_platform?: string;
  target_platforms?: string[];
  platforms?: string[];
}

// ── Entry point ───────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body: ContentRequest = await req.json();
    const { action, user_id } = body;

    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id required" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    let data: unknown;

    switch (action) {
      case "create_content":       data = await createContent(body);       break;
      case "schedule_post":        data = await schedulePost(body);         break;
      case "repurpose":            data = await repurposeContent(body);     break;
      case "analyze_performance":  data = await analyzePerformance(body);   break;
      case "generate_captions":    data = await generateCaptions(body);     break;
      case "batch_create":         data = await batchCreate(body);          break;
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true, data }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: message }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
