/**
 * Thought Distillation — Felix AI knowledge compression pipeline.
 * Processes large volumes of raw notes/journal/messages and distills them
 * into high-density semantic memories. Three-stage pipeline:
 *   1. Chunk: split source content into semantic segments
 *   2. Distill: summarize each chunk with local LLM (key insight extraction)
 *   3. Synthesize: cross-chunk synthesis into canonical knowledge packets
 *
 * Also provides contextual feature extraction (entities, concepts, relations)
 * and a sensemaking module that builds coherent narratives from disparate data.
 */

import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { storeMemory, type AgentMemory } from "@/mavis/agentMemoryEngine";
import { callLocalMesh } from "@/mavis/localMesh";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SourceDocument {
  id: string;
  title: string;
  content: string;
  source: "notes" | "journal" | "vault" | "messages" | "memories";
  date?: string;
  tags?: string[];
}

export interface TextChunk {
  id: string;
  sourceId: string;
  text: string;
  position: number; // 0-indexed within source
  tokenEstimate: number;
}

export interface DistilledInsight {
  chunkId: string;
  insight: string;
  entities: string[];
  concepts: string[];
  importance: number; // 1-10
  confidence: number; // 1-10
}

export interface KnowledgePacket {
  title: string;
  synthesis: string;
  keyInsights: string[];
  entities: string[];
  concepts: string[];
  sourceIds: string[];
  tags: string[];
  importance: number;
}

export interface DistillationResult {
  jobId: string;
  inputCount: number;
  chunkCount: number;
  insightCount: number;
  packets: KnowledgePacket[];
  memoryIds: string[];
  compressionRatio: number;
  topLevelSummary: string;
}

// ── Chunking ──────────────────────────────────────────────────────────────────

const CHUNK_TARGET_TOKENS = 400;  // ~300 words per chunk
const CHUNK_OVERLAP_TOKENS = 50;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function chunkContent(doc: SourceDocument): TextChunk[] {
  const text = doc.content.trim();
  if (!text) return [];

  // Split on semantic boundaries: double newlines, then sentences
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
  const chunks: TextChunk[] = [];
  let currentChunk = "";
  let chunkIdx = 0;

  for (const para of paragraphs) {
    const combined = currentChunk ? `${currentChunk}\n\n${para}` : para;
    if (estimateTokens(combined) > CHUNK_TARGET_TOKENS && currentChunk) {
      chunks.push({
        id: `${doc.id}:${chunkIdx}`,
        sourceId: doc.id,
        text: currentChunk.trim(),
        position: chunkIdx,
        tokenEstimate: estimateTokens(currentChunk),
      });
      chunkIdx++;
      // Overlap: keep last sentence of previous chunk
      const lastSentence = currentChunk.split(/[.!?]\s+/).pop() ?? "";
      currentChunk = lastSentence.length < CHUNK_OVERLAP_TOKENS * 4
        ? `${lastSentence} ${para}`
        : para;
    } else {
      currentChunk = combined;
    }
  }

  if (currentChunk.trim()) {
    chunks.push({
      id: `${doc.id}:${chunkIdx}`,
      sourceId: doc.id,
      text: currentChunk.trim(),
      position: chunkIdx,
      tokenEstimate: estimateTokens(currentChunk),
    });
  }

  return chunks;
}

// ── Feature extraction ────────────────────────────────────────────────────────

const ENTITY_PATTERNS = [
  /\b([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/g,  // Proper names
  /\b([A-Z]{2,})\b/g,                                     // Acronyms
  /\$([A-Z]{1,5})\b/g,                                    // Ticker symbols
];

const CONCEPT_STOP_WORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "have", "will", "they",
  "been", "are", "not", "but", "one", "all", "can", "its", "out", "more",
]);

export function extractEntities(text: string): { entities: string[]; concepts: string[] } {
  const entities = new Set<string>();
  const concepts: string[] = [];

  for (const pattern of ENTITY_PATTERNS) {
    for (const match of text.matchAll(new RegExp(pattern.source, "g"))) {
      if (match[1] && match[1].length > 2) entities.add(match[1].trim());
    }
  }

  // Extract noun phrases as concepts (simple heuristic: capitalized nouns + important lowercase terms)
  const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 4 && !CONCEPT_STOP_WORDS.has(w));
  const wordFreq = new Map<string, number>();
  for (const w of words) wordFreq.set(w, (wordFreq.get(w) ?? 0) + 1);

  const topWords = [...wordFreq.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);

  concepts.push(...topWords);

  return {
    entities: [...entities].slice(0, 15),
    concepts: concepts.slice(0, 10),
  };
}

// ── LLM-based distillation ────────────────────────────────────────────────────

async function distillChunk(chunk: TextChunk): Promise<DistilledInsight | null> {
  const prompt = `Extract the key insight from this text. Be extremely concise.

Text:
${chunk.text}

Respond with ONLY valid JSON:
{"insight":"one sentence core insight","entities":["entity1"],"concepts":["concept1"],"importance":7,"confidence":8}`;

  const result = await callLocalMesh([{ role: "user", content: prompt }]);
  if (!result) return null;

  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        chunkId: chunk.id,
        insight: String(parsed.insight ?? ""),
        entities: Array.isArray(parsed.entities) ? parsed.entities : [],
        concepts: Array.isArray(parsed.concepts) ? parsed.concepts : [],
        importance: Math.min(10, Math.max(1, Number(parsed.importance) || 5)),
        confidence: Math.min(10, Math.max(1, Number(parsed.confidence) || 5)),
      };
    }
  } catch {/* fall through */}

  // Fallback: use extractEntities and truncate content as insight
  const { entities, concepts } = extractEntities(chunk.text);
  return {
    chunkId: chunk.id,
    insight: chunk.text.slice(0, 200).replace(/\n/g, " "),
    entities,
    concepts,
    importance: 5,
    confidence: 4,
  };
}

// ── Cross-chunk synthesis (sensemaking) ───────────────────────────────────────

async function synthesizeInsights(
  insights: DistilledInsight[],
  topic: string
): Promise<KnowledgePacket | null> {
  if (insights.length === 0) return null;

  const insightList = insights
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 12)
    .map((i, n) => `${n + 1}. ${i.insight}`)
    .join("\n");

  const allEntities = [...new Set(insights.flatMap(i => i.entities))].slice(0, 20);
  const allConcepts = [...new Set(insights.flatMap(i => i.concepts))].slice(0, 15);
  const avgImportance = insights.reduce((s, i) => s + i.importance, 0) / insights.length;

  const prompt = `Synthesize these insights into a coherent knowledge packet about: ${topic}

Insights:
${insightList}

Respond with ONLY valid JSON:
{
  "title": "descriptive title",
  "synthesis": "2-3 sentence narrative connecting all insights",
  "keyInsights": ["most important takeaway 1", "most important takeaway 2", "most important takeaway 3"],
  "tags": ["tag1", "tag2", "tag3"]
}`;

  const result = await callLocalMesh([{ role: "user", content: prompt }]);

  try {
    if (result) {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          title: String(parsed.title ?? topic),
          synthesis: String(parsed.synthesis ?? insightList.slice(0, 400)),
          keyInsights: Array.isArray(parsed.keyInsights) ? parsed.keyInsights : insights.slice(0, 3).map(i => i.insight),
          entities: allEntities,
          concepts: allConcepts,
          sourceIds: [...new Set(insights.map(i => i.chunkId.split(":")[0]))],
          tags: Array.isArray(parsed.tags) ? parsed.tags : ["distilled"],
          importance: Math.round(avgImportance),
        };
      }
    }
  } catch {/* fallback */}

  return {
    title: topic,
    synthesis: insights.slice(0, 3).map(i => i.insight).join(" "),
    keyInsights: insights.slice(0, 5).map(i => i.insight),
    entities: allEntities,
    concepts: allConcepts,
    sourceIds: [...new Set(insights.map(i => i.chunkId.split(":")[0]))],
    tags: ["distilled", "auto-synthesized"],
    importance: Math.round(avgImportance),
  };
}

// ── Source fetching ───────────────────────────────────────────────────────────

async function fetchSources(
  userId: string,
  sourceTypes: Array<"notes" | "journal" | "vault" | "messages" | "memories">,
  filter?: { dateFrom?: string; dateTo?: string; tags?: string[]; limit?: number }
): Promise<SourceDocument[]> {
  const docs: SourceDocument[] = [];
  const limit = filter?.limit ?? 50;

  if (sourceTypes.includes("notes")) {
    const { data } = await supabase
      .from("mavis_notes")
      .select("id, title, content, created_at, tags")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    docs.push(...(data ?? []).map(n => ({
      id: n.id, title: n.title, content: String(n.content ?? ""),
      source: "notes" as const, date: n.created_at, tags: n.tags ?? [],
    })));
  }

  if (sourceTypes.includes("journal")) {
    const { data } = await supabase
      .from("mavis_journal")
      .select("id, title, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    docs.push(...(data ?? []).map(j => ({
      id: j.id, title: j.title ?? "Journal Entry", content: String(j.content ?? ""),
      source: "journal" as const, date: j.created_at,
    })));
  }

  if (sourceTypes.includes("vault")) {
    const { data } = await supabase
      .from("mavis_vault_entries")
      .select("id, title, content, created_at, tags")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit)
      .catch(() => ({ data: null }));
    if (data) {
      docs.push(...data.map((v: Record<string, unknown>) => ({
        id: v.id as string,
        title: v.title as string ?? "Vault Entry",
        content: String(v.content ?? ""),
        source: "vault" as const,
        date: v.created_at as string,
        tags: (v.tags as string[]) ?? [],
      })));
    }
  }

  return docs.filter(d => d.content.length > 50);
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function compressKnowledge(
  userId: string,
  sourceTypes: Array<"notes" | "journal" | "vault" | "messages">,
  topic: string,
  agentId: string,
  options?: {
    filter?: { dateFrom?: string; dateTo?: string; limit?: number };
    onProgress?: (msg: string) => void;
    jobId?: string;
  }
): Promise<DistillationResult> {
  const jobId = options?.jobId ?? crypto.randomUUID();
  const onProgress = options?.onProgress ?? (() => {});

  // Create DB job record
  await supabase.from("mavis_distillation_jobs").upsert({
    id: jobId,
    user_id: userId,
    source_types: sourceTypes,
    source_filter: options?.filter ?? {},
    status: "running",
    started_at: new Date().toISOString(),
  }).catch(() => {/* non-fatal */});

  onProgress("Fetching source documents...");
  const docs = await fetchSources(userId, sourceTypes, options?.filter);
  onProgress(`Loaded ${docs.length} documents`);

  // Chunk all documents
  onProgress("Chunking content...");
  const allChunks = docs.flatMap(d => chunkContent(d));
  const inputTokens = allChunks.reduce((s, c) => s + c.tokenEstimate, 0);
  onProgress(`Created ${allChunks.length} chunks (~${inputTokens} tokens)`);

  // Distill each chunk (process in batches of 5 to avoid overwhelming local LLM)
  onProgress("Distilling insights...");
  const insights: DistilledInsight[] = [];
  const batchSize = 5;

  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(c => distillChunk(c)));
    insights.push(...results.filter((r): r is DistilledInsight => r !== null));
    onProgress(`Distilled ${Math.min(i + batchSize, allChunks.length)}/${allChunks.length} chunks`);
  }

  // Filter low-confidence insights
  const qualityInsights = insights.filter(i => i.importance >= 4);
  onProgress(`${qualityInsights.length} quality insights extracted`);

  // Synthesize into packets (group by inferred topic clusters)
  onProgress("Synthesizing knowledge packets...");
  const packet = await synthesizeInsights(qualityInsights, topic);
  const packets = packet ? [packet] : [];

  // Store packets as semantic memories
  const memoryIds: string[] = [];
  for (const pkt of packets) {
    const memId = await storeMemory({
      agentId,
      agentName: "DistillationEngine",
      agentType: "plugin",
      entityType: "pattern",
      memoryType: "semantic",
      content: `${pkt.title}\n\n${pkt.synthesis}\n\nKey insights:\n${pkt.keyInsights.map(k => `- ${k}`).join("\n")}`,
      summary: pkt.synthesis.slice(0, 200),
      tags: [...pkt.tags, "distilled", ...sourceTypes],
      wikilinks: pkt.entities.slice(0, 5).map(e => `[[${e}]]`),
      importance: pkt.importance,
      confidence: 7,
      sourceSession: jobId,
    }, userId);
    if (memId) memoryIds.push(memId);
  }

  // Top-level synthesis across all packets
  const topSummary = packets.length > 0
    ? `Distillation of ${docs.length} sources on "${topic}": ${packets[0].synthesis}`
    : `Processed ${docs.length} sources, ${allChunks.length} chunks. No coherent patterns found above threshold.`;

  const outputTokens = topSummary.length / 4;
  const compressionRatio = inputTokens > 0 ? inputTokens / Math.max(outputTokens, 1) : 0;

  // Update job record
  await supabase.from("mavis_distillation_jobs").update({
    status: "complete",
    input_count: docs.length,
    chunk_count: allChunks.length,
    output_count: memoryIds.length,
    output_summary: topSummary,
    compression_ratio: compressionRatio,
    distilled_memory_ids: memoryIds,
    completed_at: new Date().toISOString(),
  }).eq("id", jobId).catch(() => {/* non-fatal */});

  onProgress(`Complete — ${compressionRatio.toFixed(1)}x compression, ${memoryIds.length} memories stored`);

  return {
    jobId,
    inputCount: docs.length,
    chunkCount: allChunks.length,
    insightCount: qualityInsights.length,
    packets,
    memoryIds,
    compressionRatio,
    topLevelSummary: topSummary,
  };
}

/** Schedule nightly distillation via the automation engine.
 *  Registers an automation rule rather than running immediately. */
export async function scheduleNightlyDistillation(
  userId: string,
  sourceTypes: Array<"notes" | "journal" | "vault">,
  agentId: string
): Promise<void> {
  await supabase.from("mavis_automation_rules").upsert({
    user_id: userId,
    name: "Nightly Knowledge Distillation",
    description: "Automatically compress and synthesize new knowledge each night",
    trigger_event: "schedule:daily",
    trigger_config: { hour: 3, minute: 0 }, // 3 AM local
    action_type: "run_distillation",
    action_config: { source_types: sourceTypes, topic: "daily knowledge synthesis", agent_id: agentId },
    enabled: true,
    cooldown_ms: 23 * 60 * 60 * 1000, // 23h cooldown
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,name" }).catch(() => {/* non-fatal */});
}
