/**
 * Knowledge Graph Agent — Moltbook/Obsidian autonomous note writing & refinement.
 * Agents can write, update, and link notes in the MAVIS knowledge graph.
 * Includes:
 *  - Autonomous note creation from agent outputs
 *  - Wikilink discovery and suggestion
 *  - Tag refinement via content similarity
 *  - Federated search across all knowledge sources
 *  - Knowledge graph topology analysis (orphaned nodes, missing links)
 */

import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { callLocalMesh } from "@/mavis/localMesh";
import { storeMemory } from "@/mavis/agentMemoryEngine";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KGNote {
  id?: string;
  title: string;
  content: string;
  tags: string[];
  wikilinks: string[];   // [[Entity]] references found/added
  source?: string;       // agent ID that created/updated this
  createdAt?: string;
  updatedAt?: string;
}

export interface LinkSuggestion {
  fromTitle: string;
  toTitle: string;
  reason: string;
  confidence: number; // 0-1
}

export interface TagSuggestion {
  noteId: string;
  currentTags: string[];
  suggestedTags: string[];
  reason: string;
}

export interface FederatedSearchResult {
  source: "notes" | "journal" | "vault" | "memories" | "skills";
  id: string;
  title: string;
  excerpt: string;
  relevanceScore: number;
  date?: string;
  tags?: string[];
}

export interface GraphTopology {
  totalNodes: number;
  orphanedNodes: KGNote[];    // Notes with no wikilinks or backlinks
  highDegreeNodes: Array<{ title: string; linkCount: number }>;
  missingLinks: LinkSuggestion[];
}

// ── Note creation / update ────────────────────────────────────────────────────

export async function writeNote(
  note: KGNote,
  userId: string,
  agentId: string
): Promise<string | null> {
  // Extract wikilinks from content if not provided
  if (!note.wikilinks || note.wikilinks.length === 0) {
    note.wikilinks = extractWikilinks(note.content);
  }

  // Check if note with this title already exists
  const { data: existing } = await supabase
    .from("mavis_notes")
    .select("id, content")
    .eq("user_id", userId)
    .ilike("title", note.title)
    .maybeSingle();

  if (existing) {
    // Update existing note, appending agent additions
    const updatedContent = `${existing.content}\n\n---\n*Updated by agent ${agentId}*\n\n${note.content}`;
    const { error } = await supabase
      .from("mavis_notes")
      .update({
        content: updatedContent,
        tags: note.tags,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    return error ? null : existing.id;
  }

  // Create new note
  const { data, error } = await supabase
    .from("mavis_notes")
    .insert({
      user_id: userId,
      title: note.title,
      content: note.content,
      tags: note.tags,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) return null;

  // Log creation as an agent memory
  await storeMemory({
    agentId,
    agentName: "KnowledgeGraphAgent",
    agentType: "plugin",
    entityType: "decision",
    memoryType: "episodic",
    content: `Created note: "${note.title}" with tags [${note.tags.join(", ")}]`,
    summary: `Wrote note: ${note.title}`,
    tags: ["knowledge-graph", "note-created", ...note.tags],
    wikilinks: note.wikilinks,
    importance: 5,
    confidence: 9,
  }, userId);

  return data.id;
}

export function extractWikilinks(content: string): string[] {
  const matches = content.matchAll(/\[\[([^\]]+)\]\]/g);
  return [...new Set([...matches].map(m => m[1].trim()))];
}

/** Generate a structured note from agent output text */
export async function generateNote(
  agentOutput: string,
  topic: string,
  userId: string,
  agentId: string
): Promise<KGNote | null> {
  const prompt = `Convert this content into a well-structured knowledge note about "${topic}".

Content:
${agentOutput.slice(0, 3000)}

Rules:
- Use [[WikiLink]] syntax to reference related concepts
- Add relevant tags (lowercase, no spaces)
- Structure with markdown headers
- Be concise but complete

Respond ONLY with valid JSON:
{
  "title": "Note Title",
  "content": "## Section\\n\\nContent with [[wikilinks]]...",
  "tags": ["tag1", "tag2"],
  "wikilinks": ["Entity1", "Entity2"]
}`;

  const result = await callLocalMesh([{ role: "user", content: prompt }]);
  if (!result) return null;

  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        title: String(parsed.title ?? topic),
        content: String(parsed.content ?? agentOutput.slice(0, 2000)),
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        wikilinks: Array.isArray(parsed.wikilinks) ? parsed.wikilinks : extractWikilinks(String(parsed.content ?? "")),
        source: agentId,
      };
    }
  } catch {/* fallback */}

  return {
    title: topic,
    content: agentOutput.slice(0, 2000),
    tags: ["auto-generated"],
    wikilinks: extractWikilinks(agentOutput),
    source: agentId,
  };
}

// ── Link discovery ────────────────────────────────────────────────────────────

/** Find wikilink targets that don't have a corresponding note yet */
export async function discoverMissingLinks(userId: string): Promise<string[]> {
  const { data: notes } = await supabase
    .from("mavis_notes")
    .select("title, content")
    .eq("user_id", userId);

  if (!notes) return [];

  const existingTitles = new Set(notes.map((n: Record<string, unknown>) => (n.title as string).toLowerCase()));
  const referencedTitles = new Set<string>();

  for (const note of notes) {
    const links = extractWikilinks(String(note.content ?? ""));
    links.forEach(l => referencedTitles.add(l.toLowerCase()));
  }

  return [...referencedTitles].filter(t => !existingTitles.has(t));
}

/** Suggest new links between notes based on shared concepts */
export async function suggestLinks(userId: string, limit = 10): Promise<LinkSuggestion[]> {
  const { data: notes } = await supabase
    .from("mavis_notes")
    .select("id, title, content, tags")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(30);

  if (!notes || notes.length < 2) return [];

  const suggestions: LinkSuggestion[] = [];

  for (let i = 0; i < notes.length && suggestions.length < limit; i++) {
    for (let j = i + 1; j < notes.length && suggestions.length < limit; j++) {
      const a = notes[i] as Record<string, unknown>;
      const b = notes[j] as Record<string, unknown>;

      // Already linked?
      const aLinks = extractWikilinks(String(a.content ?? ""));
      if (aLinks.some(l => l.toLowerCase() === (b.title as string).toLowerCase())) continue;

      // Shared tags
      const aTags = (a.tags as string[]) ?? [];
      const bTags = (b.tags as string[]) ?? [];
      const sharedTags = aTags.filter(t => bTags.includes(t));

      if (sharedTags.length >= 2) {
        suggestions.push({
          fromTitle: a.title as string,
          toTitle: b.title as string,
          reason: `Shared tags: ${sharedTags.join(", ")}`,
          confidence: Math.min(0.9, 0.4 + sharedTags.length * 0.15),
        });
      }
    }
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence);
}

/** Apply wikilink suggestions by updating note content */
export async function applyLinkSuggestions(
  suggestions: LinkSuggestion[],
  userId: string,
  minConfidence = 0.7
): Promise<number> {
  let applied = 0;
  const highConfidence = suggestions.filter(s => s.confidence >= minConfidence);

  for (const suggestion of highConfidence) {
    const { data: note } = await supabase
      .from("mavis_notes")
      .select("id, content")
      .eq("user_id", userId)
      .ilike("title", suggestion.fromTitle)
      .maybeSingle();

    if (!note) continue;

    // Add wikilink to content if toTitle appears as plain text
    const targetPattern = new RegExp(`\\b${suggestion.toTitle}\\b`, "i");
    if (targetPattern.test(String(note.content ?? ""))) {
      const updatedContent = (note.content as string).replace(
        targetPattern,
        `[[${suggestion.toTitle}]]`
      );
      await supabase
        .from("mavis_notes")
        .update({ content: updatedContent, updated_at: new Date().toISOString() })
        .eq("id", note.id);
      applied++;
    }
  }

  return applied;
}

// ── Tag refinement ────────────────────────────────────────────────────────────

export async function suggestTags(noteId: string, userId: string): Promise<TagSuggestion | null> {
  const { data: note } = await supabase
    .from("mavis_notes")
    .select("title, content, tags")
    .eq("id", noteId)
    .eq("user_id", userId)
    .single();

  if (!note) return null;

  // Get existing tag vocabulary
  const { data: allNotes } = await supabase
    .from("mavis_notes")
    .select("tags")
    .eq("user_id", userId);

  const tagVocab = [...new Set(
    (allNotes ?? []).flatMap((n: Record<string, unknown>) => (n.tags as string[]) ?? [])
  )].slice(0, 50);

  const prompt = `Given this note, suggest 3-5 relevant tags. Prefer tags from the existing vocabulary.

Note title: ${note.title}
Note content (excerpt): ${String(note.content ?? "").slice(0, 500)}

Current tags: ${((note.tags as string[]) ?? []).join(", ") || "none"}
Existing tag vocabulary: ${tagVocab.join(", ")}

Respond with ONLY valid JSON:
{"suggested_tags": ["tag1", "tag2"], "reason": "brief explanation"}`;

  const result = await callLocalMesh([{ role: "user", content: prompt }]);
  if (!result) return null;

  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        noteId,
        currentTags: (note.tags as string[]) ?? [],
        suggestedTags: Array.isArray(parsed.suggested_tags) ? parsed.suggested_tags : [],
        reason: String(parsed.reason ?? ""),
      };
    }
  } catch {/* no-op */}

  return null;
}

// ── Federated search ──────────────────────────────────────────────────────────

export async function federatedSearch(
  query: string,
  userId: string,
  options?: {
    sources?: Array<"notes" | "journal" | "vault" | "memories">;
    limit?: number;
  }
): Promise<FederatedSearchResult[]> {
  const sources = options?.sources ?? ["notes", "journal", "vault", "memories"];
  const limit = options?.limit ?? 5;
  const results: FederatedSearchResult[] = [];
  const queryWords = query.toLowerCase().split(/\s+/);

  // Simple relevance scorer: count query word hits in content
  function scoreText(text: string): number {
    const lower = text.toLowerCase();
    return queryWords.reduce((score, word) => {
      const count = (lower.match(new RegExp(word, "g")) ?? []).length;
      return score + count;
    }, 0);
  }

  const searches: Promise<void>[] = [];

  if (sources.includes("notes")) {
    searches.push(
      supabase.from("mavis_notes").select("id, title, content, created_at, tags")
        .eq("user_id", userId).ilike("content", `%${queryWords[0]}%`).limit(limit)
        .then(({ data }) => {
          (data ?? []).forEach((n: Record<string, unknown>) => {
            const score = scoreText(`${n.title} ${n.content}`);
            if (score > 0) results.push({
              source: "notes", id: n.id as string, title: n.title as string,
              excerpt: String(n.content ?? "").slice(0, 200), relevanceScore: score,
              date: n.created_at as string, tags: (n.tags as string[]) ?? [],
            });
          });
        })
    );
  }

  if (sources.includes("journal")) {
    searches.push(
      supabase.from("mavis_journal").select("id, title, content, created_at")
        .eq("user_id", userId).ilike("content", `%${queryWords[0]}%`).limit(limit)
        .then(({ data }) => {
          (data ?? []).forEach((j: Record<string, unknown>) => {
            const score = scoreText(`${j.title} ${j.content}`);
            if (score > 0) results.push({
              source: "journal", id: j.id as string, title: (j.title as string) ?? "Journal Entry",
              excerpt: String(j.content ?? "").slice(0, 200), relevanceScore: score,
              date: j.created_at as string,
            });
          });
        })
    );
  }

  if (sources.includes("memories")) {
    searches.push(
      supabase.from("mavis_agent_memories").select("id, agent_name, content, summary, created_at, tags")
        .eq("user_id", userId).eq("status", "active").ilike("content", `%${queryWords[0]}%`).limit(limit)
        .then(({ data }) => {
          (data ?? []).forEach((m: Record<string, unknown>) => {
            const score = scoreText(`${m.content} ${m.summary}`);
            if (score > 0) results.push({
              source: "memories", id: m.id as string,
              title: `[${m.agent_name}] Memory`,
              excerpt: (m.summary as string) ?? String(m.content ?? "").slice(0, 200),
              relevanceScore: score, date: m.created_at as string, tags: (m.tags as string[]) ?? [],
            });
          });
        })
    );
  }

  await Promise.all(searches);

  return results
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit * sources.length);
}

// ── Graph topology analysis ───────────────────────────────────────────────────

export async function analyzeGraphTopology(userId: string): Promise<GraphTopology> {
  const { data: notes } = await supabase
    .from("mavis_notes")
    .select("id, title, content, tags")
    .eq("user_id", userId);

  if (!notes) return { totalNodes: 0, orphanedNodes: [], highDegreeNodes: [], missingLinks: [] };

  const noteMap = new Map<string, KGNote>();
  const backlinkCount = new Map<string, number>();

  for (const n of notes as Array<Record<string, unknown>>) {
    const note: KGNote = {
      id: n.id as string,
      title: n.title as string,
      content: String(n.content ?? ""),
      tags: (n.tags as string[]) ?? [],
      wikilinks: extractWikilinks(String(n.content ?? "")),
    };
    noteMap.set((n.title as string).toLowerCase(), note);

    for (const link of note.wikilinks) {
      const key = link.toLowerCase();
      backlinkCount.set(key, (backlinkCount.get(key) ?? 0) + 1);
    }
  }

  const orphanedNodes = [...noteMap.values()].filter(n => {
    const hasOutLinks = n.wikilinks.length > 0;
    const hasInLinks = (backlinkCount.get(n.title.toLowerCase()) ?? 0) > 0;
    return !hasOutLinks && !hasInLinks;
  });

  const highDegreeNodes = [...noteMap.values()]
    .map(n => ({
      title: n.title,
      linkCount: n.wikilinks.length + (backlinkCount.get(n.title.toLowerCase()) ?? 0),
    }))
    .filter(n => n.linkCount >= 3)
    .sort((a, b) => b.linkCount - a.linkCount)
    .slice(0, 10);

  const missingLinks = await suggestLinks(userId, 10);

  return {
    totalNodes: noteMap.size,
    orphanedNodes: orphanedNodes.slice(0, 20),
    highDegreeNodes,
    missingLinks,
  };
}

/** Build a comprehensive summary of all knowledge on a topic */
export async function buildKnowledgeSummary(
  topic: string,
  userId: string
): Promise<string> {
  const results = await federatedSearch(topic, userId, { limit: 8 });
  if (results.length === 0) return `No knowledge found for: ${topic}`;

  const excerpts = results
    .map(r => `[${r.source.toUpperCase()} — ${r.title}]\n${r.excerpt}`)
    .join("\n\n");

  const prompt = `Synthesize this knowledge about "${topic}" into a coherent summary.

Sources:
${excerpts}

Write a 3-5 sentence synthesis that captures the most important points. Be specific.`;

  const result = await callLocalMesh([{ role: "user", content: prompt }]);
  return result?.content ?? excerpts.slice(0, 800);
}

// ── CodeGraphContext-style structural analysis ────────────────────────────────
// Queries the knowledge graph structurally (not semantically) to surface
// architectural patterns: hubs, bridges, clusters, and dead ends.
// Mirrors what Neo4j Aura would provide — implemented over Supabase tables.

export interface GraphNode {
  id:        string;
  title:     string;
  tags:      string[];
  inDegree:  number;  // how many notes link TO this
  outDegree: number;  // how many notes this links TO
}

export interface GraphEdge {
  sourceId: string;
  targetSlug: string;
}

export interface GraphStructure {
  nodes:      GraphNode[];
  edges:      GraphEdge[];
  hubs:       GraphNode[];   // high-degree nodes (architectural anchors)
  orphans:    GraphNode[];   // no in- or out-edges (isolated knowledge)
  bridges:    GraphNode[];   // single path between clusters (critical connectors)
  clusters:   string[][];    // tag-based groupings
}

export async function analyzeGraphStructure(userId: string): Promise<GraphStructure> {
  // Fetch all notes
  const { data: notes } = await supabase
    .from("mavis_notes")
    .select("id, title, tags")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(500) as { data: Array<{ id: string; title: string; tags: string[] | null }> | null };

  // Fetch all wikilinks
  const { data: wikilinks } = await supabase
    .from("mavis_note_wikilinks")
    .select("source_note_id, target_slug")
    .eq("user_id", userId) as { data: Array<{ source_note_id: string; target_slug: string }> | null };

  const noteMap = new Map((notes ?? []).map(n => [n.id, { ...n, tags: n.tags ?? [], inDegree: 0, outDegree: 0 }]));
  const edges: GraphEdge[] = wikilinks ?? [];

  // Build degree counts
  for (const edge of edges) {
    const src = noteMap.get(edge.source_note_id);
    if (src) src.outDegree++;

    // Resolve target_slug to a note ID
    for (const [, node] of noteMap) {
      if (node.title.toLowerCase() === edge.target_slug.toLowerCase()) {
        node.inDegree++;
        break;
      }
    }
  }

  const nodes = [...noteMap.values()] as GraphNode[];
  const totalDegree = (n: GraphNode) => n.inDegree + n.outDegree;

  // Hubs: top 10% by total degree
  const degreeThreshold = nodes.length > 10
    ? nodes.sort((a, b) => totalDegree(b) - totalDegree(a))[Math.floor(nodes.length * 0.1)].inDegree +
      nodes[Math.floor(nodes.length * 0.1)].outDegree
    : 2;

  const hubs    = nodes.filter(n => totalDegree(n) >= degreeThreshold && totalDegree(n) > 1);
  const orphans = nodes.filter(n => totalDegree(n) === 0);
  // Bridges: exactly 1 in-edge AND exactly 1 out-edge (single-path connectors)
  const bridges = nodes.filter(n => n.inDegree === 1 && n.outDegree === 1);

  // Clusters: group by most common tag
  const tagMap = new Map<string, string[]>();
  for (const node of nodes) {
    for (const tag of (node.tags ?? [])) {
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag)!.push(node.title);
    }
  }
  const clusters = [...tagMap.entries()]
    .filter(([, titles]) => titles.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10)
    .map(([, titles]) => titles);

  return { nodes, edges, hubs, orphans, bridges, clusters };
}

/** Human-readable summary of graph structure — inject into agent context */
export async function summarizeGraphStructure(userId: string): Promise<string> {
  const g = await analyzeGraphStructure(userId);
  const lines = [
    `KNOWLEDGE GRAPH: ${g.nodes.length} notes, ${g.edges.length} wikilinks`,
    g.hubs.length    ? `  Hubs (${g.hubs.length}): ${g.hubs.slice(0, 5).map(n => `"${n.title}"`).join(", ")}` : "",
    g.orphans.length ? `  Orphans (${g.orphans.length}): ${g.orphans.slice(0, 4).map(n => `"${n.title}"`).join(", ")} — consider linking` : "",
    g.bridges.length ? `  Bridges (${g.bridges.length}): ${g.bridges.slice(0, 3).map(n => `"${n.title}"`).join(", ")} — single points of failure` : "",
    g.clusters.length? `  Clusters: ${g.clusters.slice(0, 4).map(c => `[${c.slice(0,3).join(", ")}${c.length>3 ? "…" : ""}]`).join(" | ")}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}
