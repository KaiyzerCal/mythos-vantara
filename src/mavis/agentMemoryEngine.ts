/**
 * Agent Memory Engine — Obsidian-pattern persistent memory for all MAVIS agents.
 * Writes to mavis_agent_memories (pgvector). Supports tiered loading (always-on
 * lightweight context + on-demand semantic search) and SM-2 spaced repetition.
 */

import { supabase } from "@/integrations/supabase/client";

// ── Types ─────────────────────────────────────────────────────────────────────

export type EntityType = "experience" | "fact" | "pattern" | "relationship" | "decision" | "signal";
export type MemoryType = "episodic" | "semantic" | "procedural" | "working";
export type MemoryStatus = "active" | "archived" | "superseded";

export interface AgentMemory {
  id?: string;
  agentId: string;
  agentName: string;
  agentType: "council" | "persona" | "plugin" | "mavis";
  entityType: EntityType;
  memoryType: MemoryType;
  content: string;
  summary?: string;
  tags: string[];
  wikilinks: string[];     // [[entity]] references (Obsidian-style)
  importance: number;      // 1-10
  confidence: number;      // 1-10
  sourceSession?: string;
  nextReviewAt?: string;
  reviewCount?: number;
  easeFactor?: number;     // SM-2
  status?: MemoryStatus;
  supersededBy?: string;
  createdAt?: string;
}

export interface MemorySearchResult extends AgentMemory {
  similarity?: number;
}

// ── SM-2 spaced repetition ────────────────────────────────────────────────────

function sm2NextReview(reviewCount: number, easeFactor: number, quality: number): {
  nextReviewAt: Date;
  newEaseFactor: number;
  newReviewCount: number;
} {
  // quality: 0-5 (like SM-2 original scale)
  const newEF = Math.max(1.3, easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  const n = reviewCount + 1;
  let intervalDays: number;

  if (n === 1) intervalDays = 1;
  else if (n === 2) intervalDays = 6;
  else intervalDays = Math.round((n - 1) * newEF);

  const nextReviewAt = new Date();
  nextReviewAt.setDate(nextReviewAt.getDate() + intervalDays);

  return { nextReviewAt, newEaseFactor: newEF, newReviewCount: n };
}

// ── Store memory ──────────────────────────────────────────────────────────────

export async function storeMemory(
  memory: AgentMemory,
  userId: string,
  embedding?: number[]
): Promise<string | null> {
  const { data, error } = await supabase
    .from("mavis_agent_memories")
    .insert({
      user_id: userId,
      agent_id: memory.agentId,
      agent_name: memory.agentName,
      agent_type: memory.agentType,
      entity_type: memory.entityType,
      memory_type: memory.memoryType,
      content: memory.content,
      summary: memory.summary ?? null,
      tags: memory.tags,
      wikilinks: memory.wikilinks,
      importance: memory.importance,
      confidence: memory.confidence,
      source_session: memory.sourceSession ?? null,
      next_review_at: memory.nextReviewAt ?? null,
      review_count: memory.reviewCount ?? 0,
      ease_factor: memory.easeFactor ?? 2.5,
      status: memory.status ?? "active",
      embedding: embedding ? JSON.stringify(embedding) : null,
    })
    .select("id")
    .single();

  if (error) return null;
  return data.id as string;
}

// ── Recall via semantic search ────────────────────────────────────────────────

export async function recallMemories(
  agentId: string,
  queryEmbedding: number[],
  options?: {
    topK?: number;
    threshold?: number;
    entityType?: EntityType;
    memoryType?: MemoryType;
  }
): Promise<MemorySearchResult[]> {
  const { data, error } = await supabase.rpc("match_agent_memory", {
    query_embedding: queryEmbedding,
    match_agent_id: agentId,
    match_threshold: options?.threshold ?? 0.40,
    match_count: options?.topK ?? 8,
  });

  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>).map(row => ({
    id: row.id as string,
    agentId,
    agentName: "",
    agentType: "mavis" as const,
    entityType: row.entity_type as EntityType,
    memoryType: row.memory_type as MemoryType,
    content: row.content as string,
    summary: row.summary as string | undefined,
    tags: (row.tags as string[]) ?? [],
    wikilinks: [],
    importance: row.importance as number,
    confidence: 7,
    createdAt: row.created_at as string,
    similarity: row.similarity as number,
  }));
}

// ── Fetch recent memories (lightweight always-on tier) ────────────────────────

export async function fetchRecentMemories(
  agentId: string,
  userId: string,
  options?: {
    limit?: number;
    memoryType?: MemoryType;
    entityType?: EntityType;
    minImportance?: number;
  }
): Promise<AgentMemory[]> {
  let query = supabase
    .from("mavis_agent_memories")
    .select("*")
    .eq("agent_id", agentId)
    .eq("user_id", userId)
    .eq("status", "active")
    .order("importance", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 10);

  if (options?.memoryType) query = query.eq("memory_type", options.memoryType);
  if (options?.entityType) query = query.eq("entity_type", options.entityType);
  if (options?.minImportance) query = query.gte("importance", options.minImportance);

  const { data } = await query;
  return (data ?? []).map(_rowToMemory);
}

// ── Build prompt context (tiered injection) ───────────────────────────────────

export async function buildMemoryContext(
  agentId: string,
  userId: string,
  currentQuery: string,
  semanticEmbedding?: number[]
): Promise<string> {
  const sections: string[] = [];

  // Tier 1: Always-on high-importance + procedural memories
  const procedural = await fetchRecentMemories(agentId, userId, {
    memoryType: "procedural",
    minImportance: 7,
    limit: 5,
  });
  if (procedural.length > 0) {
    const items = procedural.map(m => `- ${m.summary ?? m.content}`).join("\n");
    sections.push(`Behavioral rules:\n${items}`);
  }

  // Tier 2: Recent working/episodic memories
  const recent = await fetchRecentMemories(agentId, userId, {
    memoryType: "working",
    limit: 5,
  });
  if (recent.length > 0) {
    const items = recent.map(m => `- ${m.summary ?? m.content}`).join("\n");
    sections.push(`Recent context:\n${items}`);
  }

  // Tier 3: Semantic search (on-demand, only when embedding provided)
  if (semanticEmbedding) {
    const semantic = await recallMemories(agentId, semanticEmbedding, { topK: 5 });
    if (semantic.length > 0) {
      const items = semantic
        .map(m => `- [${m.entityType}] ${m.summary ?? m.content} (relevance: ${(m.similarity ?? 0).toFixed(2)})`)
        .join("\n");
      sections.push(`Relevant memories:\n${items}`);
    }
  }

  return sections.length > 0
    ? `=== AGENT MEMORY ===\n${sections.join("\n\n")}\n=== END MEMORY ===`
    : "";
}

// ── Consolidate episodic → semantic ──────────────────────────────────────────

export async function consolidateMemories(
  agentId: string,
  userId: string
): Promise<number> {
  // Fetch recent episodic memories older than 24h with high importance
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("mavis_agent_memories")
    .select("*")
    .eq("agent_id", agentId)
    .eq("user_id", userId)
    .eq("memory_type", "episodic")
    .eq("status", "active")
    .gte("importance", 6)
    .lt("created_at", cutoff);

  if (!data || data.length === 0) return 0;

  let consolidated = 0;
  for (const row of data) {
    const mem = _rowToMemory(row);
    // Promote to semantic with summary
    await supabase
      .from("mavis_agent_memories")
      .update({ memory_type: "semantic", status: "archived" })
      .eq("id", mem.id!);

    await storeMemory({
      ...mem,
      id: undefined,
      memoryType: "semantic",
      summary: mem.summary ?? mem.content.slice(0, 150),
      content: mem.content,
      status: "active",
    }, userId);

    consolidated++;
  }

  return consolidated;
}

// ── Spaced repetition ─────────────────────────────────────────────────────────

export async function getMemoriesForReview(
  agentId: string,
  userId: string
): Promise<AgentMemory[]> {
  const { data } = await supabase
    .from("mavis_agent_memories")
    .select("*")
    .eq("agent_id", agentId)
    .eq("user_id", userId)
    .eq("status", "active")
    .lte("next_review_at", new Date().toISOString())
    .not("next_review_at", "is", null)
    .order("importance", { ascending: false })
    .limit(20);

  return (data ?? []).map(_rowToMemory);
}

export async function updateReview(
  memoryId: string,
  quality: number  // 0-5 quality rating
): Promise<void> {
  const { data } = await supabase
    .from("mavis_agent_memories")
    .select("review_count, ease_factor")
    .eq("id", memoryId)
    .single();

  if (!data) return;

  const { nextReviewAt, newEaseFactor, newReviewCount } = sm2NextReview(
    data.review_count,
    data.ease_factor,
    quality
  );

  await supabase
    .from("mavis_agent_memories")
    .update({
      next_review_at: nextReviewAt.toISOString(),
      ease_factor: newEaseFactor,
      review_count: newReviewCount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", memoryId);
}

// ── Supersede a belief ────────────────────────────────────────────────────────

export async function supersedeMemory(
  oldMemoryId: string,
  newMemory: AgentMemory,
  userId: string,
  embedding?: number[]
): Promise<string | null> {
  const newId = await storeMemory(newMemory, userId, embedding);
  if (!newId) return null;

  await supabase
    .from("mavis_agent_memories")
    .update({ status: "superseded", superseded_by: newId })
    .eq("id", oldMemoryId);

  return newId;
}

// ── Row → AgentMemory ─────────────────────────────────────────────────────────

function _rowToMemory(row: Record<string, unknown>): AgentMemory {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    agentName: row.agent_name as string,
    agentType: row.agent_type as AgentMemory["agentType"],
    entityType: row.entity_type as EntityType,
    memoryType: row.memory_type as MemoryType,
    content: row.content as string,
    summary: row.summary as string | undefined,
    tags: (row.tags as string[]) ?? [],
    wikilinks: (row.wikilinks as string[]) ?? [],
    importance: row.importance as number,
    confidence: row.confidence as number,
    sourceSession: row.source_session as string | undefined,
    nextReviewAt: row.next_review_at as string | undefined,
    reviewCount: row.review_count as number | undefined,
    easeFactor: row.ease_factor as number | undefined,
    status: row.status as MemoryStatus,
    supersededBy: row.superseded_by as string | undefined,
    createdAt: row.created_at as string | undefined,
  };
}
