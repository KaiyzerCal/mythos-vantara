// MAVIS Ingest URL — Ingests a web article/page URL into the MAVIS knowledge base.
// save_as: "note" (mavis_notes) or "vault" (vault_entries). Default: "note".
// Auth: Bearer user JWT.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_KEY = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function resolveUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try {
    const { data } = await adminSb.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

// Strip HTML tags for plain fallback
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

// Fetch article via Jina.ai Reader API
async function fetchViaJina(url: string): Promise<{ title: string; content: string }> {
  const jinaUrl = `https://r.jina.ai/${url}`;
  const res = await fetch(jinaUrl, {
    headers: { Accept: "text/plain" },
  });
  if (!res.ok) {
    throw new Error(`Jina fetch failed: ${res.status}`);
  }
  const raw = await res.text();

  // Extract title from first line: "Title: ..."
  let title = "";
  let content = raw;
  const lines = raw.split("\n");
  if (lines[0]?.startsWith("Title:")) {
    title = lines[0].replace(/^Title:\s*/i, "").trim();
    content = lines.slice(1).join("\n").trim();
  }

  return { title, content };
}

// Fetch article directly (HTML fallback)
async function fetchDirect(url: string): Promise<{ title: string; content: string }> {
  const res = await fetch(url, {
    headers: { Accept: "text/html,text/plain,*/*", "User-Agent": "Mozilla/5.0 (compatible; MAVISIngest/1.0)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Direct fetch failed: ${res.status}`);
  const html = await res.text();

  // Extract title from <title> tag
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim().slice(0, 200) : "";

  const content = stripHtml(html);
  return { title, content };
}

// Chunk text into ~1200 char pieces with 150 char overlap
function chunkText(text: string, chunkSize = 1200, overlap = 150): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if ((current ? current + "\n\n" + para : para).length <= chunkSize) {
      current = current ? current + "\n\n" + para : para;
    } else {
      if (current) {
        chunks.push(current.trim());
        const overlapText = current.slice(-overlap);
        current = overlapText + "\n\n" + para;
      } else {
        let i = 0;
        while (i < para.length) {
          chunks.push(para.slice(i, i + chunkSize).trim());
          i += chunkSize - overlap;
        }
        current = "";
      }
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 0);
}

// Generate embedding via OpenAI text-embedding-3-small
async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!OPENAI_KEY) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const userId = await resolveUserId(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const url = String(body.url ?? "").trim();
  const saveAs: "note" | "vault" = body.save_as === "vault" ? "vault" : "note";

  // Validate URL
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return json({ error: "url must start with http:// or https://" }, 400);
  }

  // Fetch content
  let title = "";
  let content = "";

  try {
    const result = await fetchViaJina(url);
    title = result.title;
    content = result.content;
  } catch (jinaErr) {
    console.error("[mavis-ingest-url] Jina failed, trying direct fetch:", jinaErr);
    try {
      const result = await fetchDirect(url);
      title = result.title;
      content = result.content;
    } catch (directErr) {
      console.error("[mavis-ingest-url] Direct fetch also failed:", directErr);
      return json({ error: `Failed to fetch URL: ${directErr instanceof Error ? directErr.message : String(directErr)}` }, 502);
    }
  }

  // Trim content
  const trimmedContent = content.slice(0, 12000);
  const wordCount = trimmedContent.split(/\s+/).filter(Boolean).length;
  const displayTitle = title || url.slice(0, 80);

  if (saveAs === "vault") {
    // Insert one vault_entries row
    const { data: entry, error: insertErr } = await adminSb
      .from("vault_entries")
      .insert({
        user_id: userId,
        title: displayTitle,
        content: trimmedContent.slice(0, 5000),
        category: "research",
        importance: "medium",
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("[mavis-ingest-url] vault_entries insert error:", insertErr);
      return json({ error: `Failed to save vault entry: ${insertErr.message}` }, 500);
    }

    return json({
      ok: true,
      saved_as: "vault",
      title: displayTitle,
      word_count: wordCount,
      entry_id: entry?.id,
    });
  }

  // Default: save_as === "note" — chunk and embed
  const chunks = chunkText(trimmedContent);
  const total = chunks.length;
  const noteIds: string[] = [];

  for (let i = 0; i < total; i++) {
    const chunkContent = chunks[i];
    const embedding = await generateEmbedding(chunkContent);

    const noteRecord: Record<string, unknown> = {
      user_id: userId,
      title: `[WEB] ${displayTitle} — chunk ${i + 1}/${total}`,
      content: chunkContent,
      tags: ["web-ingested", "auto"],
      aliases: [],
      properties: {
        source_url: url,
        chunk_index: i,
        total_chunks: total,
        skip_sr: true,
      },
    };

    if (embedding) {
      noteRecord.embedding = embedding;
    }

    const { data: inserted, error: insertErr } = await adminSb
      .from("mavis_notes")
      .insert(noteRecord)
      .select("id")
      .single();

    if (insertErr) {
      console.error(`[mavis-ingest-url] Insert chunk ${i} error:`, insertErr);
    } else if (inserted?.id) {
      noteIds.push(inserted.id);
    }
  }

  return json({
    ok: true,
    saved_as: "note",
    title: displayTitle,
    chunks_created: noteIds.length,
    word_count: wordCount,
    note_ids: noteIds,
  });
});
