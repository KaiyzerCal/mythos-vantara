// mavis-arxiv — Search academic papers on arXiv and save to knowledge vault
// Actions: search | get | save_to_vault
// Uses arXiv Atom API (free, no key required)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL    = Deno.env.get("SUPABASE_URL")!;
const SB_ANON   = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ARXIV_API = "https://export.arxiv.org/api/query";

async function getUser(authHeader: string) {
  const sb = createClient(SB_URL, SB_ANON, { auth: { persistSession: false } });
  const { data: { user }, error } = await sb.auth.getUser(authHeader.replace("Bearer ", ""));
  return { user, error };
}

// ─── Minimal Atom XML parser ──────────────────────────────────
function extractTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : "";
}

function extractAllBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, "gi");
  return xml.match(re) ?? [];
}

function parseEntry(entry: string) {
  // ID: http://arxiv.org/abs/2301.00001v1 → 2301.00001
  const rawId = extractTag(entry, "id");
  const id = rawId.replace(/^https?:\/\/arxiv\.org\/abs\//, "").replace(/v\d+$/, "");

  const title = extractTag(entry, "title").replace(/\s+/g, " ");
  const summary = extractTag(entry, "summary").replace(/\s+/g, " ");
  const published = extractTag(entry, "published").slice(0, 10);
  const updated   = extractTag(entry, "updated").slice(0, 10);

  const authorBlocks = extractAllBlocks(entry, "author");
  const authors = authorBlocks.map(a => extractTag(a, "name")).filter(Boolean);

  const catMatches = [...entry.matchAll(/category[^>]+term="([^"]+)"/g)];
  const categories = catMatches.map(m => m[1]).filter(c => !c.includes("http"));

  return {
    id,
    title,
    abstract: summary.slice(0, 600) + (summary.length > 600 ? "…" : ""),
    full_abstract: summary,
    authors,
    categories,
    primary_category: categories[0] ?? null,
    published,
    updated,
    arxiv_url: `https://arxiv.org/abs/${id}`,
    pdf_url: `https://arxiv.org/pdf/${id}`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const { user, error: authErr } = await getUser(authHeader);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? "search";

    // ── SEARCH ────────────────────────────────────────────
    if (action === "search") {
      const query: string    = body.query    ?? "";
      const category: string = body.category ?? ""; // e.g. cs.AI, cs.LG, stat.ML
      const author: string   = body.author   ?? "";
      const max_results      = Math.min(body.max_results ?? 10, 25);
      const sort_by: string  = body.sort_by  ?? "relevance"; // relevance | submittedDate | lastUpdatedDate

      if (!query && !category && !author) {
        return new Response(JSON.stringify({ error: "query, category, or author required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const parts: string[] = [];
      if (query)    parts.push(`all:${query}`);
      if (author)   parts.push(`au:${author}`);
      if (category) parts.push(`cat:${category}`);
      const search_query = parts.join("+AND+");

      const params = new URLSearchParams({
        search_query,
        start: "0",
        max_results: String(max_results),
        sortBy: sort_by,
        sortOrder: "descending",
      });

      const res = await fetch(`${ARXIV_API}?${params}`);
      if (!res.ok) throw new Error(`arXiv API error: ${res.status}`);
      const xml = await res.text();

      const entries = extractAllBlocks(xml, "entry");
      const papers  = entries.map(parseEntry);

      return new Response(JSON.stringify({
        ok: true,
        query: body.query ?? null,
        category: category || null,
        author: author || null,
        count: papers.length,
        papers,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── GET (single paper by ID) ──────────────────────────
    if (action === "get") {
      const raw: string = body.paper_id ?? body.id ?? "";
      if (!raw) {
        return new Response(JSON.stringify({ error: "paper_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const clean = raw
        .replace(/^arxiv:/i, "")
        .replace(/^https?:\/\/arxiv\.org\/abs\//, "")
        .replace(/v\d+$/, "");

      const res = await fetch(`${ARXIV_API}?id_list=${clean}`);
      if (!res.ok) throw new Error(`arXiv API error: ${res.status}`);
      const xml = await res.text();

      const entries = extractAllBlocks(xml, "entry");
      if (!entries.length) {
        return new Response(JSON.stringify({ ok: false, error: "Paper not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        ok: true,
        paper: parseEntry(entries[0]),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── SAVE_TO_VAULT (fetch paper + save as mavis_note) ──
    if (action === "save_to_vault") {
      const raw: string  = body.paper_id ?? body.id ?? "";
      const extra_tags: string[] = body.tags ?? [];

      if (!raw) {
        return new Response(JSON.stringify({ error: "paper_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const clean = raw
        .replace(/^arxiv:/i, "")
        .replace(/^https?:\/\/arxiv\.org\/abs\//, "")
        .replace(/v\d+$/, "");

      const res = await fetch(`${ARXIV_API}?id_list=${clean}`);
      const xml = await res.text();
      const entries = extractAllBlocks(xml, "entry");
      if (!entries.length) {
        return new Response(JSON.stringify({ error: "Paper not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const p = parseEntry(entries[0]);
      const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

      const content = [
        `# ${p.title}`,
        "",
        `**Authors:** ${p.authors.join(", ")}`,
        `**Published:** ${p.published}`,
        `**Categories:** ${p.categories.join(", ")}`,
        `**arXiv:** ${p.arxiv_url}`,
        `**PDF:** ${p.pdf_url}`,
        "",
        "## Abstract",
        "",
        p.full_abstract,
      ].join("\n");

      const tags = ["arxiv", "research", ...p.categories.slice(0, 3), ...extra_tags]
        .filter((t, i, a) => a.indexOf(t) === i);

      const { data: note, error: noteErr } = await sb
        .from("mavis_notes")
        .upsert(
          { user_id: user.id, title: p.title, content, tags, source_url: p.arxiv_url },
          { onConflict: "user_id,source_url", ignoreDuplicates: false },
        )
        .select("id")
        .single();

      if (noteErr) throw new Error(noteErr.message);

      return new Response(JSON.stringify({
        ok: true,
        note_id: note.id,
        paper_id: clean,
        title: p.title,
        arxiv_url: p.arxiv_url,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("mavis-arxiv error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
