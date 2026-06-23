// MAVIS Readwise Import — imports highlights from Readwise API or CSV into mavis_notes with embeddings

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_KEY    = Deno.env.get("OPENAI_API") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── JWT auth ───────────────────────────────────────────────────
async function getUserId(req: Request): Promise<string | null> {
  try {
    const auth  = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const secret = Deno.env.get("SUPABASE_JWT_SECRET");
    if (secret) {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      );
      const signedPart = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
      const b64        = parts[2].replace(/-/g, "+").replace(/_/g, "/");
      const padded     = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      const sig        = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
      const valid      = await crypto.subtle.verify("HMAC", key, sig, signedPart);
      if (!valid) return null;
      const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const payload    = JSON.parse(atob(payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4)));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload.sub ?? null;
    }
    const { data } = await supabase.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ── Embedding generation ───────────────────────────────────────
async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!OPENAI_KEY) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.slice(0, 8000),
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

// ── Highlight shape ────────────────────────────────────────────
interface Highlight {
  text: string;
  title: string;
  author: string | null;
  source_url: string | null;
}

// ── Fetch highlights from Readwise API ────────────────────────
async function fetchReadwiseHighlights(token: string): Promise<Highlight[]> {
  // Fetch books for title/author lookup
  const booksRes = await fetch(
    "https://readwise.io/api/v2/books/?page_size=100",
    { headers: { Authorization: `Token ${token}` } },
  );
  if (!booksRes.ok) throw new Error(`Readwise books fetch failed: ${booksRes.status}`);
  const booksData = await booksRes.json();
  const bookMap: Record<number, { title: string; author: string | null }> = {};
  for (const book of (booksData.results ?? []) as any[]) {
    bookMap[book.id] = { title: book.title ?? "", author: book.author ?? null };
  }

  // Fetch highlights
  const highlightsRes = await fetch(
    "https://readwise.io/api/v2/highlights/?page_size=100",
    { headers: { Authorization: `Token ${token}` } },
  );
  if (!highlightsRes.ok) throw new Error(`Readwise highlights fetch failed: ${highlightsRes.status}`);
  const highlightsData = await highlightsRes.json();

  return ((highlightsData.results ?? []) as any[]).map((h: any) => {
    const book = bookMap[h.book_id] ?? { title: "Unknown", author: null };
    return {
      text:       String(h.text ?? ""),
      title:      book.title,
      author:     book.author,
      source_url: h.url ?? null,
    };
  });
}

// ── Parse CSV highlights ───────────────────────────────────────
function parseCsvHighlights(csv: string): Highlight[] {
  const lines = csv.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  // Parse header (first line)
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idxHighlight  = header.indexOf("highlight");
  const idxTitle      = header.indexOf("title");
  const idxAuthor     = header.indexOf("author");
  const idxSourceUrl  = header.indexOf("source_url");

  const highlights: Highlight[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const get  = (idx: number) => (idx >= 0 && idx < cols.length ? cols[idx].trim() : "");
    highlights.push({
      text:       get(idxHighlight),
      title:      get(idxTitle),
      author:     get(idxAuthor) || null,
      source_url: get(idxSourceUrl) || null,
    });
  }
  return highlights;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const userId = await getUserId(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const readwiseToken = body.readwise_token ? String(body.readwise_token) : null;
  const csvText       = body.csv_text       ? String(body.csv_text)       : null;
  const sourceLabel   = body.source_label   ? String(body.source_label)   : "readwise";

  if (!readwiseToken && !csvText) {
    return new Response(
      JSON.stringify({ error: "Must provide either readwise_token or csv_text" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    // Parse highlights from source
    let highlights: Highlight[] = [];
    if (readwiseToken) {
      highlights = await fetchReadwiseHighlights(readwiseToken);
    } else if (csvText) {
      highlights = parseCsvHighlights(csvText);
    }

    let imported = 0;
    let skipped  = 0;

    // Process each highlight
    for (const h of highlights) {
      if (!h.text || h.text.length < 20) {
        skipped++;
        continue;
      }

      const noteTitle = `[Highlight] ${h.title} — ${h.author ?? "Unknown"}`;

      // Generate embedding
      const embedding = await generateEmbedding(h.text);

      // Upsert to mavis_notes (conflict on user_id + title)
      const { error } = await supabase
        .from("mavis_notes")
        .upsert(
          {
            user_id:    userId,
            title:      noteTitle,
            content:    h.text,
            tags:       ["highlight", "readwise", sourceLabel],
            embedding,
            properties: {
              author:     h.author,
              source:     h.title,
              source_url: h.source_url ?? null,
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,title" },
        );

      if (error) {
        console.error("[mavis-readwise-import] Upsert error:", error.message);
        skipped++;
      } else {
        imported++;
      }
    }

    return new Response(
      JSON.stringify({ imported, skipped }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[mavis-readwise-import]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
