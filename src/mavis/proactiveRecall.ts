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
 * Format recalled memories as a compact context block for system prompt injection.
 * Returns null if no relevant memories found.
 */
export async function buildRecallContext(
  userId: string,
  userMessage: string,
  topK = 3,
): Promise<string | null> {
  if (!userMessage || userMessage.trim().length < 10) return null;

  const memories = await recallRelevantMemories(userId, userMessage, topK);
  if (memories.length === 0) return null;

  const lines = memories.map(m => `• ${m.content}`);
  return `RELEVANT PAST CONTEXT:\n${lines.join("\n")}`;
}
