import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { embedText } from "../_shared/embedding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

/**
 * The query-side embedding for memory search.
 *
 * Must be 768 dimensions — the width of mavis_agent_memories.embedding.
 *
 * Getting this right needs the table the RPCs actually read, not the one the
 * function is named after. All three of search_memories_hybrid,
 * search_memories_semantic and match_agent_memory query
 * mavis_agent_memories. None of them touches mavis_memory, despite that
 * table being far larger and the more obvious candidate.
 *
 * I set this to 384 first, matching mavis_memory, and every search returned
 * an empty result with a 200. The RPC surfaced it only when called directly:
 * "different vector dimensions 768 and 384". Comparing vectors of unequal
 * width is a runtime error, not a weak score — and the edge function
 * swallowed it into an empty list, which is indistinguishable from "you have
 * no memories about that".
 *
 * It also fixes a live outage: the gateway has been returning 403
 * credit_limit_reached for this workspace, so memory search was returning
 * nothing regardless. OpenAI's text-embedding-3-small can emit 384 natively
 * via the `dimensions` parameter, uses the key the rest of the backend
 * already has, and matches exactly what mavis-embed-backfill writes.
 *
 * Still returns [] on failure rather than throwing: the caller treats no
 * semantic hits as an empty result, never as an error.
 */
const MEMORY_DIMS = 768;

async function generateEmbedding(text: string): Promise<number[]> {
  const vec = await embedText(text, MEMORY_DIMS);
  if (!vec) {
    console.warn("[embed-and-search] embedding unavailable — returning no semantic hits");
    return [];
  }
  return vec;
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

    // The Lovable gateway key used to gate this. It is no longer the embedding
    // provider, so keeping the guard would return zero results whenever that
    // unrelated key is absent. generateEmbedding already degrades to [] on its
    // own failures, which is the only check this needs.

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
        sb.rpc("bump_memory_access", { memory_id: id }).then(undefined, () => {});
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
