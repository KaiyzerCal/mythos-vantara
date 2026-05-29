/**
 * Proactive Memory Recall — Mem0-inspired automatic context injection.
 * Before every MAVIS response, searches local BM25 index and Supabase
 * semantic index for relevant past memories and injects them into context.
 *
 * Two-stage retrieval:
 *   1. Local BM25 (fast, offline-capable) via localEmbeddings
 *   2. Supabase full-text search on mavis_agent_memories (cloud)
 * Results are deduplicated and ranked by relevance + importance.
 */

import { searchLocal } from "@/mavis/localEmbeddings";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

export interface RecalledMemory {
  content: string;
  source: "local" | "cloud";
  relevanceScore: number;
  importance?: number;
}

/**
 * Retrieve top-K relevant memories for a given user message.
 * Returns formatted string ready for injection into system prompt.
 */
export async function recallRelevantMemories(
  userId: string,
  userMessage: string,
  topK = 4,
): Promise<RecalledMemory[]> {
  const recalled: RecalledMemory[] = [];

  // Stage 1: Local BM25 search (fast, works offline)
  try {
    const localResults = await searchLocal(userMessage, topK);
    for (const r of localResults) {
      recalled.push({
        content: r.doc.content.slice(0, 200),
        source: "local",
        relevanceScore: r.score,
      });
    }
  } catch { /* BM25 index may not be populated yet */ }

  // Stage 2: Cloud full-text search on agent memories
  try {
    const words = userMessage
      .split(/\s+/)
      .filter(w => w.length > 4)
      .slice(0, 6)
      .join(" | ");

    if (words.length > 0) {
      const { data } = await supabase
        .from("mavis_agent_memories")
        .select("content, importance, created_at")
        .eq("user_id", userId)
        .eq("status", "active")
        .textSearch("content", words, { type: "websearch", config: "english" })
        .order("importance", { ascending: false })
        .limit(topK);

      for (const m of data ?? []) {
        const content = String(m.content).slice(0, 200);
        // Deduplicate against local results
        const isDupe = recalled.some(r => r.content.slice(0, 80) === content.slice(0, 80));
        if (!isDupe) {
          recalled.push({
            content,
            source: "cloud",
            relevanceScore: (m.importance ?? 5) / 10,
            importance: m.importance,
          });
        }
      }
    }
  } catch { /* Cloud search unavailable */ }

  // Sort by relevance score descending, cap at topK
  return recalled
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, topK);
}

/**
 * Semantic vector search using Gemini text-embedding-004 via edge function.
 * Falls back gracefully if the edge function is unavailable.
 */
export async function recallSemanticMemories(
  userId: string,
  userMessage: string,
  topK = 4,
): Promise<RecalledMemory[]> {
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const { data: { session } } = await _supabase.auth.getSession();
    if (!session?.access_token || !supabaseUrl) return [];

    const res = await fetch(`${supabaseUrl}/functions/v1/embed-and-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ query: userMessage, user_id: userId, top_k: topK }),
    });

    if (!res.ok) return [];
    const data = await res.json();

    return (data.results ?? []).map((r: any) => ({
      content: String(r.content ?? "").slice(0, 200),
      source: "cloud" as const,
      relevanceScore: r.similarity ?? 0.5,
      importance: r.importance,
    }));
  } catch {
    return [];
  }
}

/**
 * Format recalled memories as a compact context block for system prompt injection.
 * Returns null if no relevant memories found.
 */
export async function buildRecallContext(
  userId: string,
  userMessage: string,
  topK = 3,
): Promise<string | null> {
  if (!userMessage || userMessage.trim().length < 10) return null;

  const [keywordMemories, semanticMemories] = await Promise.all([
    recallRelevantMemories(userId, userMessage, topK),
    recallSemanticMemories(userId, userMessage, topK),
  ]);

  // Stage 3: Mem0 API search (if configured)
  let mem0Memories: RecalledMemory[] = [];
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const { data: { session: s3 } } = await _supabase.auth.getSession();
    if (s3?.access_token && supabaseUrl) {
      const r = await fetch(`${supabaseUrl}/functions/v1/mavis-mem0`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s3.access_token}` },
        body: JSON.stringify({ action: "search", user_id: userId, query: userMessage, limit: topK }),
      });
      if (r.ok) {
        const d = await r.json();
        mem0Memories = (d.results ?? []).map((m: any) => ({
          content: String(m.memory ?? "").slice(0, 200),
          source: "cloud" as const,
          relevanceScore: m.score ?? 0.6,
        }));
      }
    }
  } catch { /* Mem0 unavailable */ }

  // Merge and deduplicate
  const seen = new Set<string>();
  const combined: RecalledMemory[] = [];
  for (const m of [...keywordMemories, ...semanticMemories, ...mem0Memories]) {
    const key = m.content.slice(0, 80);
    if (!seen.has(key)) {
      seen.add(key);
      combined.push(m);
    }
  }

  const memories = combined
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, topK);

  if (memories.length === 0) return null;

  const lines = memories.map(m => `• ${m.content}`);
  return `RELEVANT PAST CONTEXT:\n${lines.join("\n")}`;
}
