// MAVIS Ingest — URL / text / clip intake pipeline
// Accepts: { type: "url"|"text"|"clip", content: string, tags?: string[], user_id?: string }
// For URLs: fetches + strips HTML → AI summary → saves note + embedding
// For text/clip: uses content directly → AI summary → saves note + embedding

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_KEY   = Deno.env.get("LOVABLE_API_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_KEY    = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const OPERATOR_UID  = Deno.env.get("TELEGRAM_OPERATOR_USER_ID") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

// ── AI helper ──────────────────────────────────────────────────
async function callAI(system: string, user: string): Promise<string> {
  if (LOVABLE_KEY) {
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_KEY}` },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          max_tokens: 800,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }),
      });
      if (res.ok) {
        const d = await res.json();
        const t = d.choices?.[0]?.message?.content ?? "";
        if (t) return t;
      }
    } catch { /* fall through */ }
  }
  if (ANTHROPIC_KEY) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 800, system,
          messages: [{ role: "user", content: user }] }),
      });
      if (res.ok) { const d = await res.json(); return d.content?.[0]?.text ?? ""; }
    } catch { /* fall through */ }
  }
  if (OPENAI_KEY) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 800,
          messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      });
      if (res.ok) { const d = await res.json(); return d.choices?.[0]?.message?.content ?? ""; }
    } catch { /* fall through */ }
  }
  return "";
}

// ── Strip HTML to plain text ───────────────────────────────────
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim().slice(0, 200) : "";
}

// ── URL fetch + strip ──────────────────────────────────────────
async function fetchUrl(url: string): Promise<{ title: string; body: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MAVISIngest/1.0)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`URL fetch failed: ${res.status}`);
  const html  = await res.text();
  const title = extractTitle(html);
  const body  = stripHtml(html).slice(0, 12000);
  return { title, body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const body = await req.json();
    const type: "url" | "text" | "clip" = body.type ?? "text";
    const content: string = String(body.content ?? "").trim();
    const extraTags: string[] = Array.isArray(body.tags) ? body.tags : [];
    const userId: string = body.user_id ?? OPERATOR_UID;

    if (!content) return new Response(JSON.stringify({ error: "content required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!userId) return new Response(JSON.stringify({ error: "user_id required (or set TELEGRAM_OPERATOR_USER_ID)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    let rawTitle = "";
    let rawBody  = content;

    if (type === "url") {
      const fetched = await fetchUrl(content);
      rawTitle = fetched.title;
      rawBody  = fetched.body;
    }

    // AI: generate note title + summary + key facts + suggested tags
    const aiSystem = `You are a knowledge extraction assistant for a personal second-brain system. Given input text, produce a structured note ready to save.

Respond with ONLY JSON (no markdown fences):
{
  "title": "concise note title (max 80 chars)",
  "summary": "2-4 sentence summary of the core insight or content",
  "key_facts": ["fact 1", "fact 2", "fact 3"],
  "tags": ["tag1", "tag2"]
}`;

    const aiInput = rawTitle
      ? `Source: ${rawTitle}\n\nContent:\n${rawBody.slice(0, 6000)}`
      : `Content:\n${rawBody.slice(0, 6000)}`;

    let noteTitle   = rawTitle || content.slice(0, 80);
    let noteContent = rawBody.slice(0, 8000);
    let noteTags    = ["ingest", type, ...extraTags];

    const aiRaw = await callAI(aiSystem, aiInput);
    const jsonMatch = aiRaw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.title)   noteTitle = String(parsed.title).slice(0, 120);
        if (parsed.summary && parsed.key_facts) {
          const facts = (parsed.key_facts as string[]).map((f: string) => `- ${f}`).join("\n");
          noteContent = `## Summary\n${parsed.summary}\n\n## Key Facts\n${facts}\n\n## Source\n${type === "url" ? content : "(direct input)"}\n\n---\n\n${rawBody.slice(0, 4000)}`;
        } else if (parsed.summary) {
          noteContent = `${parsed.summary}\n\n---\n\n${rawBody.slice(0, 4000)}`;
        }
        if (Array.isArray(parsed.tags)) {
          noteTags = [...new Set([...noteTags, ...parsed.tags.map(String)])];
        }
      } catch { /* use fallbacks */ }
    }

    // Save via mavis-knowledge
    const saveRes = await fetch(`${SUPABASE_URL}/functions/v1/mavis-knowledge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        action:  "create_note",
        userId,
        title:   noteTitle,
        content: noteContent,
        tags:    noteTags,
        aliases: type === "url" ? [content] : [],
      }),
    });

    if (!saveRes.ok) {
      const errText = await saveRes.text();
      throw new Error(`mavis-knowledge error ${saveRes.status}: ${errText}`);
    }

    const saved = await saveRes.json();

    return new Response(
      JSON.stringify({
        ok:      true,
        title:   noteTitle,
        tags:    noteTags,
        note_id: saved.note?.id,
        message: `Saved "${noteTitle}" to Knowledge Graph.`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (err) {
    console.error("[mavis-ingest]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
