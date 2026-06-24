// MAVIS Article Extractor
// Fetches any URL, strips HTML, and extracts the article title + clean body text via Claude.
// Optionally writes the result back to a mavis_social_queue row.
//
// POST { url: string, queue_id?: string }
// Returns { title, text, word_count }
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GEMINI_KEY    = Deno.env.get("GEMINI_API_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ── Strip HTML to plain text ──────────────────────────────────────────────────

function stripHtml(html: string): string {
  // Remove scripts, styles, and nav boilerplate
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
  return text;
}

// ── AI extraction ─────────────────────────────────────────────────────────────

async function extractWithAI(rawText: string, url: string): Promise<{ title: string; text: string }> {
  const prompt = `You are an article extractor. Given the raw text scraped from a webpage, extract:
1. The article title (a short, accurate title)
2. The main article body text only — no navigation, ads, comments, footers, or unrelated content

Raw text from ${url}:
---
${rawText.slice(0, 12000)}
---

Respond in this exact JSON format (no markdown code block, just raw JSON):
{"title":"...","text":"..."}`;

  // Tier 1 — Gemini Flash (fast + free)
  if (GEMINI_KEY) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 4096, responseMimeType: "application/json" },
          }),
        }
      );
      if (res.ok) {
        const d = await res.json();
        const raw = d.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        if (raw) {
          try { return JSON.parse(raw); } catch { /* fall through */ }
        }
      }
    } catch { /* fall through */ }
  }

  // Tier 2 — Claude Haiku
  if (ANTHROPIC_KEY) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (res.ok) {
      const d = await res.json();
      const raw = d.content?.[0]?.text ?? "";
      try {
        const parsed = JSON.parse(raw);
        return parsed;
      } catch {
        return { title: "Extracted Article", text: raw };
      }
    }
  }

  // Fallback — return the raw text
  return { title: "Extracted Article", text: rawText.slice(0, 8000) };
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: { url?: string; queue_id?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { url, queue_id } = body;
  if (!url?.startsWith("http")) return json({ error: "url is required and must start with http" }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // Mark queue row as extracting if provided
  if (queue_id) {
    await sb.from("mavis_social_queue" as any)
      .update({ extraction_status: "done", status: "extracting" })
      .eq("id", queue_id)
      .catch(() => {});
  }

  // Fetch the URL
  let htmlContent: string;
  try {
    const fetchRes = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MAVIS-Bot/1.0; +https://mavis.app)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!fetchRes.ok) throw new Error(`HTTP ${fetchRes.status}`);
    htmlContent = await fetchRes.text();
  } catch (err: any) {
    if (queue_id) {
      await sb.from("mavis_social_queue" as any)
        .update({ extraction_status: "failed", status: "failed", error_message: `Fetch failed: ${err.message}` })
        .eq("id", queue_id)
        .catch(() => {});
    }
    return json({ error: `Failed to fetch URL: ${err.message}` }, 502);
  }

  // Strip HTML → plain text
  const rawText = stripHtml(htmlContent);

  // AI extraction
  const { title, text } = await extractWithAI(rawText, url);
  const wordCount = text.trim().split(/\s+/).length;

  // Write back to queue if requested
  if (queue_id) {
    await sb.from("mavis_social_queue" as any)
      .update({
        article_title: title,
        article_text: text,
        extraction_status: "done",
        status: "generating",
      })
      .eq("id", queue_id)
      .catch(() => {});
  }

  return json({ title, text, word_count: wordCount });
});
