// Nightly memory consolidation — Felix-equivalent pattern.
// Reads unconsolidated Layer 2 messages, extracts Layer 1 (knowledge) + Layer 3 (tacit),
// marks messages consolidated, and logs the run.
//
// Actions:
//   (default / no action)   — nightly Layer 1 + Layer 3 extraction
//   "consolidate_memories"  — cluster near-duplicate memories by embedding similarity and merge

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

async function callClaude(systemPrompt: string, userContent: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  const data = await response.json();
  return data?.content?.[0]?.text ?? "";
}

const EXTRACTION_PROMPT = `You are MAVIS's memory consolidation system. Analyze this conversation transcript and extract durable knowledge.

Respond with ONLY valid JSON in this exact structure:
{
  "knowledge": [
    {"category": "project|area|resource|archive", "title": "...", "content": "...", "tags": ["..."]}
  ],
  "tacit": [
    {"category": "preference|hard_rule|lesson_learned|workflow_habit|communication_style", "key": "...", "value": "...", "confidence": 1-10}
  ],
  "summary": "One paragraph summary of this session"
}

Rules:
- Only include entries with real, durable signal
- Skip routine exchanges and small talk
- knowledge.title must be unique and descriptive
- tacit.key must be concise (under 60 chars)
- If nothing useful to extract, return empty arrays`;

// ---------------------------------------------------------------------------
// Semantic memory consolidation helpers
// ---------------------------------------------------------------------------

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

interface MemoryRow {
  id: string;
  content: string;
  timestamp: string;
  tags: string[] | null;
  importance_score: number | null;
  embedding: unknown; // arrives as a string from Supabase
}

function parseEmbedding(raw: unknown): number[] | null {
  if (!raw) return null;
  try {
    return JSON.parse(String(raw)) as number[];
  } catch {
    return null;
  }
}

/** Greedy cluster: each unassigned node seeds a cluster with all others within threshold. */
function clusterByEmbedding(
  rows: Array<{ row: MemoryRow; embedding: number[] }>,
  threshold: number,
): Array<Array<{ row: MemoryRow; embedding: number[] }>> {
  const assigned = new Set<number>();
  const clusters: Array<Array<{ row: MemoryRow; embedding: number[] }>> = [];

  for (let i = 0; i < rows.length; i++) {
    if (assigned.has(i)) continue;
    const cluster: Array<{ row: MemoryRow; embedding: number[] }> = [rows[i]];
    assigned.add(i);
    for (let j = i + 1; j < rows.length; j++) {
      if (assigned.has(j)) continue;
      if (cosineSim(rows[i].embedding, rows[j].embedding) > threshold) {
        cluster.push(rows[j]);
        assigned.add(j);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// consolidate_memories action
// ---------------------------------------------------------------------------

async function handleConsolidateMemories(body: Record<string, unknown>): Promise<Response> {
  const limit: number = typeof body.limit === "number" ? body.limit : 200;
  const similarityThreshold: number =
    typeof body.similarity_threshold === "number" ? body.similarity_threshold : 0.88;
  const minClusterSize: number =
    typeof body.min_cluster_size === "number" ? body.min_cluster_size : 2;

  // 1. Find all users that have unconsolidated memories
  const { data: rawUsers, error: usersErr } = await supabase
    .from("mavis_memory")
    .select("user_id")
    .eq("consolidated", false)
    .limit(limit);

  if (usersErr) {
    return new Response(JSON.stringify({ error: String(usersErr) }), { status: 500 });
  }

  const uniqueUsers = [...new Set((rawUsers ?? []).map((u: any) => u.user_id as string))];

  let totalClustersMerged = 0;
  let totalMemoriesConsolidated = 0;
  let totalSkippedNoEmbedding = 0;

  for (const userId of uniqueUsers) {
    // 2. Fetch unconsolidated memories WITH embeddings for this user
    const { data: memories, error: memErr } = await supabase
      .from("mavis_memory")
      .select("id, content, timestamp, tags, importance_score, embedding")
      .eq("user_id", userId)
      .eq("consolidated", false)
      .order("timestamp", { ascending: false })
      .limit(limit);

    if (memErr || !memories || memories.length < minClusterSize) continue;

    // 3. Separate rows with valid embeddings
    const withEmbedding: Array<{ row: MemoryRow; embedding: number[] }> = [];
    let skippedNoEmbedding = 0;

    for (const mem of memories as MemoryRow[]) {
      const emb = parseEmbedding(mem.embedding);
      if (emb && emb.length > 0) {
        withEmbedding.push({ row: mem, embedding: emb });
      } else {
        skippedNoEmbedding++;
      }
    }

    totalSkippedNoEmbedding += skippedNoEmbedding;

    if (withEmbedding.length < minClusterSize) continue;

    // 4. Cluster by cosine similarity
    const clusters = clusterByEmbedding(withEmbedding, similarityThreshold);
    const meaningfulClusters = clusters.filter((c) => c.length >= minClusterSize);

    // 5. For each cluster: merge via Claude Haiku, insert merged memory, mark originals consolidated
    for (const cluster of meaningfulClusters) {
      const contents = cluster.map((c, idx) => `Memory ${idx + 1}:\n${c.row.content}`).join("\n\n");

      const mergedText = await callClaude(
        "Merge these similar memories into one distilled, comprehensive memory. Keep all unique information. Be concise. Return only the merged memory text, nothing else.",
        contents,
      );

      if (!mergedText.trim()) continue;

      // Derive merged metadata
      const importanceScore = cluster.reduce(
        (max, c) => Math.max(max, c.row.importance_score ?? 0),
        0,
      );

      const allTags: string[] = [];
      for (const c of cluster) {
        if (c.row.tags) allTags.push(...c.row.tags);
      }
      const unionTags = [...new Set(allTags)];

      const mostRecentTimestamp = cluster
        .map((c) => c.row.timestamp)
        .sort()
        .reverse()[0];

      const clusterIds = cluster.map((c) => c.row.id);

      // Insert the merged memory (consolidated = false — it is a new memory)
      await supabase.from("mavis_memory").insert({
        user_id: userId,
        content: mergedText.trim(),
        importance_score: importanceScore,
        tags: unionTags,
        timestamp: mostRecentTimestamp,
        consolidated: false,
      });

      // Mark all originals as consolidated
      await supabase
        .from("mavis_memory")
        .update({ consolidated: true })
        .in("id", clusterIds);

      totalClustersMerged++;
      totalMemoriesConsolidated += cluster.length;
    }
  }

  return new Response(
    JSON.stringify({
      status: "consolidation complete",
      clusters_merged: totalClustersMerged,
      memories_consolidated: totalMemoriesConsolidated,
      skipped_no_embedding: totalSkippedNoEmbedding,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}

// ---------------------------------------------------------------------------
// Default nightly consolidation action (Layer 1 + Layer 3 extraction)
// ---------------------------------------------------------------------------

async function handleNightlyConsolidation(): Promise<Response> {
  // Find all users with unconsolidated messages
  const { data: rawUsers } = await supabase
    .from("mavis_memory")
    .select("user_id")
    .eq("consolidated", false)
    .limit(200);

  const uniqueUsers = [...new Set((rawUsers ?? []).map((u: any) => u.user_id))];
  const results: Record<string, unknown>[] = [];

  for (const userId of uniqueUsers) {
    try {
      const { data: messages } = await supabase
        .from("mavis_memory")
        .select("*")
        .eq("user_id", userId)
        .eq("consolidated", false)
        .order("timestamp", { ascending: true })
        .limit(100);

      if (!messages || messages.length < 3) continue;

      const transcript = messages
        .map((m: any) => `[${m.role.toUpperCase()}]: ${m.content}`)
        .join("\n\n");

      const rawResult = await callClaude(EXTRACTION_PROMPT, transcript);

      let parsed: {
        knowledge: Array<{ category: string; title: string; content: string; tags: string[] }>;
        tacit: Array<{ category: string; key: string; value: string; confidence: number }>;
        summary: string;
      };

      try {
        const clean = rawResult.replace(/```json|```/g, "").trim();
        parsed = JSON.parse(clean);
      } catch {
        console.error(`[Consolidation] JSON parse failed for user ${userId}`);
        continue;
      }

      // Write Layer 1 — knowledge graph
      for (const entry of parsed.knowledge ?? []) {
        await supabase.from("mavis_knowledge").upsert({
          user_id: userId,
          category: entry.category,
          title: entry.title,
          content: entry.content,
          tags: entry.tags ?? [],
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,title" });
      }

      // Write Layer 3 — tacit knowledge
      for (const entry of parsed.tacit ?? []) {
        await supabase.from("mavis_tacit").upsert({
          user_id: userId,
          category: entry.category,
          key: entry.key,
          value: entry.value,
          confidence: entry.confidence ?? 5,
          source: "nightly_consolidation",
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,key" });
      }

      // Mark messages as consolidated
      await supabase
        .from("mavis_memory")
        .update({ consolidated: true })
        .in("id", messages.map((m: any) => m.id));

      // Log the run
      await supabase.from("mavis_consolidation_log").insert({
        user_id: userId,
        session_date: new Date().toISOString().split("T")[0],
        messages_processed: messages.length,
        knowledge_entries_created: parsed.knowledge?.length ?? 0,
        tacit_entries_created: parsed.tacit?.length ?? 0,
        summary: parsed.summary,
      });

      results.push({
        userId,
        messagesProcessed: messages.length,
        knowledgeCreated: parsed.knowledge?.length ?? 0,
        tacitCreated: parsed.tacit?.length ?? 0,
      });
    } catch (err) {
      console.error(`[Consolidation] Failed for user ${userId}:`, err);
      results.push({ userId, error: String(err) });
    }
  }

  return new Response(JSON.stringify({
    status: "consolidation complete",
    usersProcessed: uniqueUsers.length,
    results,
  }), { headers: { "Content-Type": "application/json" } });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      try {
        body = await req.json();
      } catch {
        // no body or non-JSON body — treat as default action
      }
    }

    const action = body.action as string | undefined;

    switch (action) {
      case "consolidate_memories":
        return await handleConsolidateMemories(body);

      default:
        return await handleNightlyConsolidation();
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
