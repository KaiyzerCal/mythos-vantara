/**
 * Memory Conflict Detector — Mem0-inspired conflict detection and resolution.
 * When storing new memories, checks for semantic contradictions with existing ones.
 * Uses keyword overlap as a lightweight conflict signal (no LLM call required).
 * Marks superseded memories as "superseded" rather than deleting them.
 */

import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

export interface MemoryConflict {
  existingId: string;
  existingContent: string;
  newContent: string;
  conflictType: "contradiction" | "supersession" | "refinement";
  confidence: number;
}

/** Extract meaningful keywords from text for overlap-based conflict detection */
function extractKeywords(text: string): Set<string> {
  const STOP_WORDS = new Set(["the","a","an","is","are","was","were","be","been","has","have","had","do","does","did","will","would","could","should","may","might","i","you","he","she","it","we","they","this","that","these","those","in","on","at","to","for","of","and","or","but","not","with","from","by"]);
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w))
  );
}

/** Jaccard similarity between two keyword sets */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

/** Detect negation patterns suggesting contradiction */
function hasContradictionSignal(existing: string, incoming: string): boolean {
  const negations = ["not ", "never ", "no longer ", "stopped ", "quit ", "cancelled ", "won't ", "isn't ", "aren't ", "doesn't ", "don't "];
  const existingLower = existing.toLowerCase();
  const incomingLower = incoming.toLowerCase();
  // One has negation of a shared keyword
  const sharedKeywords = [...extractKeywords(existing)].filter(k => extractKeywords(incoming).has(k));
  if (sharedKeywords.length === 0) return false;
  const existingNegated = negations.some(n => existingLower.includes(n));
  const incomingNegated = negations.some(n => incomingLower.includes(n));
  return existingNegated !== incomingNegated && sharedKeywords.length >= 2;
}

/**
 * Check if new memory content conflicts with existing memories for this user.
 * Returns detected conflicts sorted by confidence descending.
 */
export async function detectConflicts(
  userId: string,
  agentId: string,
  newContent: string,
  entityType?: string,
): Promise<MemoryConflict[]> {
  // Fetch recent active memories for this agent
  const { data: existing } = await supabase
    .from("mavis_agent_memories")
    .select("id, content, memory_type, entity_type")
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(50);

  if (!existing?.length) return [];

  const newKeywords = extractKeywords(newContent);
  const conflicts: MemoryConflict[] = [];

  for (const mem of existing) {
    const existingKeywords = extractKeywords(String(mem.content));
    const similarity = jaccardSimilarity(newKeywords, existingKeywords);

    if (similarity < 0.25) continue; // Not related enough to conflict

    const contradiction = hasContradictionSignal(String(mem.content), newContent);
    const conflictType = contradiction ? "contradiction" : similarity > 0.6 ? "supersession" : "refinement";
    const confidence = contradiction ? 0.8 : similarity;

    conflicts.push({
      existingId: mem.id,
      existingContent: String(mem.content).slice(0, 200),
      newContent: newContent.slice(0, 200),
      conflictType,
      confidence,
    });
  }

  return conflicts.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}

/**
 * Resolve conflicts by marking superseded memories as inactive.
 * Only resolves "supersession" and high-confidence "contradiction" conflicts.
 */
export async function resolveConflicts(
  conflicts: MemoryConflict[],
  newMemoryId?: string,
): Promise<number> {
  let resolved = 0;
  for (const conflict of conflicts) {
    if (conflict.conflictType === "refinement" && conflict.confidence < 0.7) continue;
    await supabase
      .from("mavis_agent_memories")
      .update({ status: "superseded", superseded_by: newMemoryId ?? null })
      .eq("id", conflict.existingId)
      .catch(() => {});
    resolved++;
  }
  return resolved;
}

/**
 * Full pipeline: detect then resolve. Returns conflict count.
 */
export async function detectAndResolveConflicts(
  userId: string,
  agentId: string,
  newContent: string,
  newMemoryId?: string,
): Promise<number> {
  const conflicts = await detectConflicts(userId, agentId, newContent);
  if (conflicts.length === 0) return 0;
  return resolveConflicts(conflicts, newMemoryId);
}
