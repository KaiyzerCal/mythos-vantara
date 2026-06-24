// MAVIS Social Publisher
// Orchestrates the full AI Social Media pipeline (replaces Make.com "AI Social Media System").
//
// Three parallel content paths from one article URL:
//   Path A — Long-form  : Facebook + LinkedIn + Instagram  + DALL-E image
//   Path B — Short-form : Twitter/X + Threads              (text only)
//   Path C — Video      : TikTok                           (HeyGen avatar video)
//
// POST body options:
//   { queue_id: string }                     — process an existing queue row
//   { source_url: string, user_id: string }  — create a new queue row and process it
//   Optionally: paths?: ('A'|'B'|'C')[], dry_run?: boolean
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   ANTHROPIC_API_KEY, GEMINI_API_KEY
//   (BLOTATO_API_KEY and HEYGEN_API_KEY used inside their respective functions)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GEMINI_KEY    = Deno.env.get("GEMINI_API_KEY") ?? "";
const FUNCTIONS_URL = SUPABASE_URL.replace("supabase.co", "supabase.co") + "/functions/v1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ── Internal function caller ──────────────────────────────────────────────────

async function callFunction(name: string, body: unknown): Promise<Record<string, any>> {
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json().catch(() => ({}));
  return data as Record<string, any>;
}

// ── AI content generation ─────────────────────────────────────────────────────

async function callAI(system: string, user: string): Promise<string> {
  if (GEMINI_KEY) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: user }] }],
            generationConfig: { maxOutputTokens: 2048 },
          }),
        }
      );
      if (res.ok) {
        const d = await res.json();
        const t: string = d.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        if (t.trim()) return t.trim();
      }
    } catch { /* fall through */ }
  }
  if (ANTHROPIC_KEY) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (res.ok) { const d = await res.json(); return d.content?.[0]?.text?.trim() ?? ""; }
  }
  throw new Error("No AI provider configured");
}

interface ContentPackage {
  facebook?: string;
  linkedin?: string;
  instagram?: string;
  twitter?: string;
  threads?: string;
  video_script?: string;
  video_caption?: string;
  tiktok_caption?: string;
  image_prompt?: string;
}

async function generateContent(title: string, articleText: string, paths: string[]): Promise<ContentPackage> {
  const excerpt = articleText.slice(0, 3000);
  const pkg: ContentPackage = {};

  const tasks: Promise<void>[] = [];

  if (paths.includes("A")) {
    tasks.push(
      callAI(
        "You are a social media content strategist. Write platform-specific posts that are authentic, engaging, and drive action. Never use generic corporate language.",
        `Article: "${title}"\n\n${excerpt}\n\n---\nWrite 3 platform-specific posts in JSON format (no markdown block, raw JSON):
{
  "facebook": "Detailed, story-driven post (150-300 words). Include emojis. End with a question to drive comments.",
  "linkedin": "Professional insight post (100-200 words). Lead with a bold insight. Include 3-5 relevant hashtags at the end.",
  "instagram": "Visual, punchy post (50-100 words) with strong hook. 5-10 relevant hashtags on new lines at the end.",
  "image_prompt": "DALL-E image prompt (50-80 words) that visually represents this article's core message. Photorealistic style."
}`
      ).then(async (raw) => {
        try {
          const d = JSON.parse(raw.replace(/```json\n?|```/g, "").trim());
          pkg.facebook    = d.facebook;
          pkg.linkedin    = d.linkedin;
          pkg.instagram   = d.instagram;
          pkg.image_prompt = d.image_prompt;
        } catch {
          // If JSON parse fails, use raw as linkedin fallback
          pkg.linkedin = raw.slice(0, 3000);
        }
      })
    );
  }

  if (paths.includes("B")) {
    tasks.push(
      callAI(
        "You write viral short-form social content. Be punchy and direct. No fluff.",
        `Article: "${title}"\n\n${excerpt}\n\n---\nWrite 2 short-form posts in JSON (raw JSON, no code block):
{
  "twitter": "Tweet/X post (max 280 chars). Hook in first 5 words. No hashtags or 1 max.",
  "threads": "Threads post (max 500 chars). Conversational, slightly longer than tweet. Can include 1-2 hashtags."
}`
      ).then(async (raw) => {
        try {
          const d = JSON.parse(raw.replace(/```json\n?|```/g, "").trim());
          pkg.twitter = d.twitter;
          pkg.threads = d.threads;
        } catch {
          pkg.twitter = raw.slice(0, 280);
        }
      })
    );
  }

  if (paths.includes("C")) {
    tasks.push(
      callAI(
        "You write short video scripts for AI avatar social videos. Conversational, upbeat, maximum 15 seconds when spoken aloud (~35-40 words).",
        `Article: "${title}"\n\n${excerpt.slice(0, 1000)}\n\n---\nWrite a TikTok/Reels video package in JSON (raw JSON, no code block):
{
  "video_script": "15-second avatar speaking script (35-40 words). Direct address to viewer. Strong hook + value + CTA.",
  "video_caption": "TikTok caption for the video (100-150 chars). Hook line + 5-8 trending hashtags.",
  "tiktok_caption": "Full TikTok post text (200-300 chars with hashtags)."
}`
      ).then(async (raw) => {
        try {
          const d = JSON.parse(raw.replace(/```json\n?|```/g, "").trim());
          pkg.video_script   = d.video_script;
          pkg.video_caption  = d.video_caption;
          pkg.tiktok_caption = d.tiktok_caption;
        } catch {
          pkg.video_script = raw.slice(0, 200);
        }
      })
    );
  }

  await Promise.all(tasks);
  return pkg;
}

// ── Main orchestration ────────────────────────────────────────────────────────

async function runPipeline(
  queueId: string,
  sb: ReturnType<typeof createClient>,
  paths: string[],
  dryRun: boolean,
): Promise<Record<string, any>> {
  // Load queue row
  const { data: row, error } = await sb
    .from("mavis_social_queue" as any)
    .select("*")
    .eq("id", queueId)
    .single();

  if (error || !row) throw new Error("Queue row not found: " + queueId);

  const r = row as Record<string, any>;
  const publishResults: Record<string, any> = {};

  // ── Step 1: Extract article (if text not yet available) ────────────────────
  let articleText: string = r.article_text ?? "";
  let articleTitle: string = r.article_title ?? "";

  if (!articleText && r.source_url) {
    await sb.from("mavis_social_queue" as any)
      .update({ status: "extracting" }).eq("id", queueId);

    const extracted = await callFunction("mavis-article-extractor", {
      url: r.source_url,
      queue_id: queueId,
    });
    articleText  = extracted.text ?? "";
    articleTitle = extracted.title ?? r.source_url;
  }

  if (!articleText) throw new Error("No article text available — provide source_url or article_text");

  // ── Step 2: Generate per-platform content ──────────────────────────────────
  await sb.from("mavis_social_queue" as any)
    .update({ status: "generating" }).eq("id", queueId);

  const content = await generateContent(articleTitle, articleText, paths);

  // Persist generated content to queue row
  await sb.from("mavis_social_queue" as any).update({
    facebook_content: content.facebook,
    linkedin_content: content.linkedin,
    instagram_content: content.instagram,
    twitter_content: content.twitter,
    threads_content: content.threads,
    video_script: content.video_script,
    video_caption: content.video_caption,
    tiktok_content: content.tiktok_caption,
  }).eq("id", queueId);

  if (dryRun) {
    await sb.from("mavis_social_queue" as any)
      .update({ status: "ready" }).eq("id", queueId);
    return { status: "ready", dry_run: true, content };
  }

  // ── Step 3: Publish (3 paths) ──────────────────────────────────────────────
  await sb.from("mavis_social_queue" as any)
    .update({ status: "publishing" }).eq("id", queueId);

  const publishPromises: Promise<void>[] = [];

  // ── Path A: Long-form + image → Facebook, LinkedIn, Instagram ─────────────
  if (paths.includes("A") && (content.facebook || content.linkedin || content.instagram)) {
    publishPromises.push((async () => {
      let imageUrl: string | undefined;

      // Generate DALL-E/Imagen image if we have a prompt
      if (content.image_prompt) {
        const imgRes = await callFunction("mavis-image-gen", {
          prompt: content.image_prompt,
          size: "1024x1024",
          quality: "standard",
        });
        imageUrl = imgRes.url;
        if (imageUrl) {
          await sb.from("mavis_social_queue" as any)
            .update({ generated_image_url: imageUrl, image_status: "done" })
            .eq("id", queueId);
        }
      }

      const platformsA: string[] = [];
      const contentMap: Record<string, string> = {};
      if (content.facebook)  { platformsA.push("facebook");  contentMap["facebook"]  = content.facebook!; }
      if (content.linkedin)  { platformsA.push("linkedin");  contentMap["linkedin"]  = content.linkedin!; }
      if (content.instagram) { platformsA.push("instagram"); contentMap["instagram"] = content.instagram!; }

      // Publish each with its platform-specific content
      for (const platform of platformsA) {
        const res = await callFunction("mavis-blotato", {
          platforms: [platform],
          content: contentMap[platform],
          ...(imageUrl ? { image_url: imageUrl } : {}),
          title: articleTitle,
        });
        publishResults[platform] = res;
      }
    })());
  }

  // ── Path B: Short-form text → Twitter + Threads ───────────────────────────
  if (paths.includes("B") && (content.twitter || content.threads)) {
    publishPromises.push((async () => {
      if (content.twitter) {
        const res = await callFunction("mavis-blotato", {
          platforms: ["twitter"],
          content: content.twitter,
        });
        publishResults["twitter"] = res;
      }
      if (content.threads) {
        const res = await callFunction("mavis-blotato", {
          platforms: ["threads"],
          content: content.threads,
        });
        publishResults["threads"] = res;
      }
    })());
  }

  // ── Path C: HeyGen video → TikTok ─────────────────────────────────────────
  if (paths.includes("C") && content.video_script) {
    publishPromises.push((async () => {
      // Create HeyGen video
      const videoRes = await callFunction("mavis-heygen", {
        action: "create",
        script: content.video_script,
        title: `${articleTitle} — TikTok`,
      });

      const videoId = videoRes.video_id;
      if (videoId) {
        await sb.from("mavis_social_queue" as any)
          .update({ heygen_video_id: videoId, video_status: "processing" })
          .eq("id", queueId);

        publishResults["heygen"] = { video_id: videoId, status: "processing" };

        // Poll up to ~3 minutes (18 × 10s)
        let videoUrl: string | undefined;
        for (let i = 0; i < 18; i++) {
          await new Promise(r => setTimeout(r, 10_000));
          const poll = await callFunction("mavis-heygen", { action: "poll", video_id: videoId });
          if (poll.status === "complete") { videoUrl = poll.video_url; break; }
          if (poll.status === "failed")   break;
        }

        if (videoUrl) {
          await sb.from("mavis_social_queue" as any)
            .update({ video_url: videoUrl, video_status: "done" })
            .eq("id", queueId);

          const tikRes = await callFunction("mavis-blotato", {
            platforms: ["tiktok"],
            content: content.tiktok_caption ?? content.video_caption ?? articleTitle,
            video_url: videoUrl,
          });
          publishResults["tiktok"] = tikRes;
        } else {
          await sb.from("mavis_social_queue" as any)
            .update({ video_status: "failed" }).eq("id", queueId);
          publishResults["tiktok"] = { error: "HeyGen video did not complete in time" };
        }
      }
    })());
  }

  await Promise.all(publishPromises);

  // ── Mark published ─────────────────────────────────────────────────────────
  await sb.from("mavis_social_queue" as any).update({
    status: "published",
    published_at: new Date().toISOString(),
    publish_results: publishResults,
  }).eq("id", queueId);

  return { status: "published", results: publishResults };
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const sb       = createClient(SUPABASE_URL, SERVICE_KEY);
  const paths    = (body.paths as string[] | undefined) ?? ["A", "B", "C"];
  const dryRun   = body.dry_run === true;

  try {
    let queueId: string = body.queue_id ?? "";

    // Create new queue row if source_url given directly
    if (!queueId && body.source_url) {
      const userId = body.user_id;
      if (!userId) return json({ error: "user_id required when creating queue row from source_url" }, 400);

      const { data: newRow, error: insertErr } = await sb
        .from("mavis_social_queue" as any)
        .insert({
          user_id: userId,
          source_url: body.source_url,
          scheduled_date: body.scheduled_date ?? null,
          notes: body.notes ?? null,
          article_text: body.article_text ?? null,
          article_title: body.article_title ?? null,
        })
        .select("id")
        .single();

      if (insertErr) throw new Error("Failed to create queue row: " + insertErr.message);
      queueId = (newRow as any).id;
    }

    if (!queueId) return json({ error: "queue_id or (source_url + user_id) required" }, 400);

    const result = await runPipeline(queueId, sb, paths, dryRun);
    return json({ ok: true, queue_id: queueId, ...result });
  } catch (err: any) {
    console.error("mavis-social-publisher error:", err.message);
    return json({ ok: false, error: err.message }, 500);
  }
});
