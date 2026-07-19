// mavis-entity-graph
// Builds and queries a knowledge graph of entities from MAVIS conversations.
// Entities: people, companies, projects, places, concepts, products, events.
// Relationships: works_at, manages, collaborates_with, part_of, related_to, etc.
//
// Actions:
//   POST { action: "build" } → process new memories, extract entities
//   POST { action: "query", query: string, type?: string, limit?: number } → search graph
// verify_jwt = false (cron + service-role triggers)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_KEY = (Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY")) ?? "";

const sb = () => createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ── Entity extraction via Claude Haiku ────────────────────────────────────────

interface ExtractedEntity {
  name: string;
  type: "person" | "company" | "project" | "place" | "concept" | "product" | "event";
  description: string;
  aliases?: string[];
}

interface ExtractedRelationship {
  entity_a: string;
  relationship: string;
  entity_b: string;
  strength: number;
  context?: string;
}

interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

async function extractEntities(text: string): Promise<ExtractionResult> {
  if (!ANTHROPIC_KEY) return { entities: [], relationships: [] };

  const prompt = `Extract entities and relationships from this text for a personal knowledge graph.

TEXT:
${text.slice(0, 3000)}

Return JSON with this exact structure:
{
  "entities": [
    {"name": "Full Name", "type": "person|company|project|place|concept|product|event", "description": "1 sentence", "aliases": []}
  ],
  "relationships": [
    {"entity_a": "Name A", "relationship": "works_at|manages|collaborates_with|part_of|related_to|owns|uses|competes_with|invests_in|mentors", "entity_b": "Name B", "strength": 0.0-1.0, "context": "brief context"}
  ]
}

Rules:
- Only extract named entities (proper nouns, specific projects, etc.)
- Skip generic words like "AI", "system", "tool" unless they are named products
- Minimum 2 character names
- Strength: 0.9=direct relationship, 0.6=inferred, 0.3=weak signal
- Return empty arrays if nothing meaningful found
- ONLY return valid JSON, no other text`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) return { entities: [], relationships: [] };
    const d = await res.json();
    const text2 = d.content?.find((b: any) => b.type === "text")?.text ?? "{}";
    const jsonMatch = text2.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { entities: [], relationships: [] };
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      relationships: Array.isArray(parsed.relationships) ? parsed.relationships : [],
    };
  } catch {
    return { entities: [], relationships: [] };
  }
}

// ── Embed entity for semantic search ─────────────────────────────────────────

async function embedText(text: string): Promise<number[] | null> {
  if (!OPENAI_KEY) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 512) }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

// ── Upsert entity ─────────────────────────────────────────────────────────────

async function upsertEntity(
  userId: string,
  entity: ExtractedEntity,
): Promise<string | null> {
  const validTypes = ["person", "company", "project", "place", "concept", "product", "event"];
  if (!validTypes.includes(entity.type)) return null;
  if (!entity.name || entity.name.length < 2) return null;

  // Try to find existing entity (case-insensitive name match)
  const { data: existing } = await sb()
    .from("mavis_entities")
    .select("id, mention_count")
    .eq("user_id", userId)
    .ilike("name", entity.name)
    .eq("entity_type", entity.type)
    .maybeSingle();

  if (existing) {
    // Update mention count and description
    await sb()
      .from("mavis_entities")
      .update({
        mention_count: existing.mention_count + 1,
        last_mentioned: new Date().toISOString(),
        description: entity.description || undefined,
      })
      .eq("id", existing.id);
    return existing.id;
  }

  // Create new entity
  const embedding = await embedText(`${entity.name}: ${entity.description}`);
  const { data, error } = await sb()
    .from("mavis_entities")
    .insert({
      user_id: userId,
      name: entity.name,
      entity_type: entity.type,
      description: entity.description ?? "",
      aliases: entity.aliases ?? [],
      embedding: embedding ?? undefined,
    })
    .select("id")
    .single();

  if (error) {
    // Handle unique constraint violation (concurrent insert)
    if (error.code === "23505") {
      const { data: retry } = await sb()
        .from("mavis_entities")
        .select("id")
        .eq("user_id", userId)
        .ilike("name", entity.name)
        .eq("entity_type", entity.type)
        .maybeSingle();
      return retry?.id ?? null;
    }
    return null;
  }

  return data.id;
}

// ── Upsert relationship ───────────────────────────────────────────────────────

async function upsertRelationship(
  userId: string,
  entityAId: string,
  entityBId: string,
  relationship: string,
  strength: number,
  context: string,
): Promise<void> {
  await sb()
    .from("mavis_entity_relationships")
    .upsert({
      user_id: userId,
      entity_a_id: entityAId,
      entity_b_id: entityBId,
      relationship,
      strength: Math.min(1, Math.max(0, strength)),
      context: context.slice(0, 500),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,entity_a_id,entity_b_id,relationship" });
}

// ── Build graph for a user ────────────────────────────────────────────────────

async function buildGraph(userId: string): Promise<{ memories_processed: number; entities_found: number; relationships_found: number }> {
  // Get cursor
  const { data: cursor } = await sb()
    .from("mavis_entity_graph_cursor")
    .select("last_processed_at")
    .eq("user_id", userId)
    .maybeSingle();

  const since = cursor?.last_processed_at ?? "1970-01-01T00:00:00Z";

  // Fetch new memories
  const { data: memories } = await sb()
    .from("mavis_memory")
    .select("content, created_at")
    .eq("user_id", userId)
    .in("role", ["user"])
    .gte("created_at", since)
    .gt("importance_score", 3)
    .order("created_at", { ascending: true })
    .limit(100);

  if (!memories || memories.length === 0) {
    return { memories_processed: 0, entities_found: 0, relationships_found: 0 };
  }

  // Process in batches of 5 (combine text for richer context)
  let totalEntities = 0;
  let totalRelationships = 0;
  const newCursor = memories[memories.length - 1].created_at;

  for (let i = 0; i < memories.length; i += 5) {
    const batch = memories.slice(i, i + 5);
    const combined = batch.map((m: any) => m.content).join("\n---\n");

    const { entities, relationships } = await extractEntities(combined);
    totalEntities += entities.length;
    totalRelationships += relationships.length;

    // Upsert entities and build ID map
    const entityIdMap = new Map<string, string>();
    for (const entity of entities) {
      const id = await upsertEntity(userId, entity);
      if (id) entityIdMap.set(entity.name.toLowerCase(), id);
    }

    // Upsert relationships
    for (const rel of relationships) {
      const aId = entityIdMap.get(rel.entity_a.toLowerCase());
      const bId = entityIdMap.get(rel.entity_b.toLowerCase());
      if (aId && bId && aId !== bId) {
        await upsertRelationship(userId, aId, bId, rel.relationship, rel.strength, rel.context ?? "");
      }
    }
  }

  // Update cursor
  await sb()
    .from("mavis_entity_graph_cursor")
    .upsert({ user_id: userId, last_processed_at: newCursor }, { onConflict: "user_id" });

  return {
    memories_processed: memories.length,
    entities_found: totalEntities,
    relationships_found: totalRelationships,
  };
}

// ── Query graph ───────────────────────────────────────────────────────────────

async function queryGraph(
  userId: string,
  query: string,
  type?: string,
  limit = 10,
): Promise<string> {
  let q = sb()
    .from("mavis_entities")
    .select(`
      id, name, entity_type, description, mention_count, last_mentioned,
      entity_a_relationships:mavis_entity_relationships!entity_a_id(
        relationship, strength, context,
        entity_b:entity_b_id(name, entity_type)
      ),
      entity_b_relationships:mavis_entity_relationships!entity_b_id(
        relationship, strength, context,
        entity_a:entity_a_id(name, entity_type)
      )
    `)
    .eq("user_id", userId);

  if (type) q = q.eq("entity_type", type);
  q = q.ilike("name", `%${query}%`).order("mention_count", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return `Entity graph query error: ${error.message}`;
  if (!data || data.length === 0) return `No entities found matching "${query}"${type ? ` of type ${type}` : ""}.`;

  const formatted = data.map((e: any) => {
    const rels = [
      ...(e.entity_a_relationships ?? []).map((r: any) => `→ ${r.relationship} → ${r.entity_b?.name} (${r.entity_b?.entity_type})`),
      ...(e.entity_b_relationships ?? []).map((r: any) => `← ${r.relationship} ← ${r.entity_a?.name} (${r.entity_a?.entity_type})`),
    ];
    return [
      `**${e.name}** [${e.entity_type}] — mentioned ${e.mention_count}x`,
      e.description ? `  ${e.description}` : "",
      rels.length > 0 ? `  Relationships:\n  ${rels.slice(0, 5).join("\n  ")}` : "",
    ].filter(Boolean).join("\n");
  });

  return formatted.join("\n\n");
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  let body: any = {};
  try {
    if (req.method === "POST") body = await req.json().catch(() => ({}));
  } catch { /* ignore */ }

  const action = body.action ?? "query";
  const isCron = Boolean(body.cron);

  // Auth
  let userId: string | null = null;
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");

  if (isCron || token === SB_KEY) {
    userId = body.user_id ?? null;
  } else {
    const { data: { user } } = await createClient(SB_URL, SB_KEY).auth.getUser(token);
    userId = user?.id ?? null;
  }

  try {
    if (action === "build") {
      if (isCron) {
        // Process all users with recent memories
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data: activeUsers } = await sb()
          .from("mavis_memory")
          .select("user_id")
          .gte("created_at", cutoff)
          .limit(100);

        const uniqueUsers = [...new Set((activeUsers ?? []).map((r: any) => r.user_id as string))];
        let total = { memories: 0, entities: 0, relationships: 0 };

        for (const uid of uniqueUsers) {
          try {
            const r = await buildGraph(uid);
            total.memories += r.memories_processed;
            total.entities += r.entities_found;
            total.relationships += r.relationships_found;
          } catch (err: any) {
            console.error(`[entity-graph] build failed for ${uid}:`, err.message);
          }
        }

        return json({ users: uniqueUsers.length, ...total });
      }

      if (!userId) return json({ error: "Unauthorized" }, 401);
      const result = await buildGraph(userId);
      return json(result);
    }

    if (action === "query") {
      // Can be queried by user or by mavis-agent (service role with user_id)
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const query = String(body.query ?? "");
      const type = body.type ? String(body.type) : undefined;
      const limit = Number(body.limit ?? 10);
      if (!query) return json({ error: "query is required" }, 400);
      const result = await queryGraph(userId, query, type, limit);
      return json({ result });
    }

    return json({ error: "Unknown action. Use 'build' or 'query'." }, 400);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[entity-graph] Error:", message);
    return json({ error: message }, 500);
  }
});
