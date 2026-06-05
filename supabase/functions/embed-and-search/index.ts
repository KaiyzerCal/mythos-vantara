import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// Simple in-memory rate limiter: max 1 req per 800ms per user
const lastCallAt = new Map<string, number>();
function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const last = lastCallAt.get(userId) ?? 0;
  if (now - last < 800) return true;
  lastCallAt.set(userId, now);
  return false;
}

async function generateEmbedding(text: string): Promise<number[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/text-embedding-004",
        content: { parts: [{ text: text.slice(0, 2000) }] },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini embedding failed: ${res.status}`);
  const data = await res.json();
  return data?.embedding?.values ?? [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { query, user_id, top_k = 6 } = await req.json();
    if (!query || !user_id) {
      return new Response(JSON.stringify({ error: "query and user_id are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!GEMINI_KEY) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (isRateLimited(user_id)) {
      return new Response(JSON.stringify({ results: [], rate_limited: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const embedding = await generateEmbedding(query);
    if (embedding.length === 0) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use hybrid BM25+vector+RRF+decay search
    const { data, error } = await sb.rpc("search_memories_hybrid", {
      query_embedding: embedding,
      query_text: query,
      match_user_id: user_id,
      match_count: top_k,
    });

    if (error) {
      // Fall back to pure semantic search if hybrid function not yet applied
      console.warn("Hybrid search failed, falling back to semantic:", error.message);
      const { data: fallback } = await sb.rpc("search_memories_semantic", {
        query_embedding: embedding,
        match_user_id: user_id,
        match_count: top_k,
      });
      return new Response(JSON.stringify({ results: fallback ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Bump access count for top 3 retrieved memories (non-blocking)
    if (Array.isArray(data) && data.length > 0) {
      const topIds = data.slice(0, 3).map((r: any) => r.id).filter(Boolean);
      topIds.forEach((id: string) => {
        sb.rpc("bump_memory_access", { memory_id: id }).catch(() => {});
      });
    }

    return new Response(JSON.stringify({ results: data ?? [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("embed-and-search error:", err.message);
    return new Response(JSON.stringify({ error: err.message, results: [] }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
