// Fill in embeddings for entries written before semantic search existed.
//
// This function is the reason the feature is real rather than nominal. The
// database already had eight vector columns before this work and almost
// nothing in them — mavis_memory holds 2632 rows and zero embeddings. A
// column with no data behaves exactly like a broken search: every query
// returns nothing, and the model reports it cannot find the entry. So the
// backfill ships with the schema, not after it.
//
// Resumable by construction: it only ever selects rows WHERE embedding IS
// NULL, so re-running continues where it stopped and running it twice is
// harmless. Call it repeatedly until `remaining` reaches 0.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { embedText, embeddableText, embeddingKey } from "../_shared/embedding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Kept small: each row is one embedding API call, and the function has a wall clock. */
const DEFAULT_BATCH = 25;
const MAX_BATCH = 100;

interface Backfillable {
  table: string;
  /** Omitted where the table has no name-ish column — memory rows are prose only. */
  titleCol?: string;
  bodyCol: string;
  /**
   * The width the column declares. Not decoration: Postgres rejects a vector
   * of the wrong length outright, so getting this wrong fails every row.
   */
  dims?: number;
}

const TABLES: Record<string, Backfillable> = {
  journal:       { table: "journal_entries", titleCol: "title", bodyCol: "content" },
  vault:         { table: "vault_entries",   titleCol: "title", bodyCol: "content" },
  quests:        { table: "quests",          titleCol: "title", bodyCol: "description" },
  meeting_notes: { table: "meeting_notes",   titleCol: "title", bodyCol: "summary" },
  notebooks:     { table: "notebooks",       titleCol: "title", bodyCol: "description" },

  // The memory system. Older tables, built against different models, so their
  // vectors are narrower — see _shared/embedding.ts. mavis-memory-embed was
  // meant to fill these using Supabase's built-in gte-small, but its cron was
  // never created and the model exhausts the edge worker's memory
  // (WORKER_RESOURCE_LIMIT) when invoked.
  //
  // Which table the *memory* search reads is not obvious from the names:
  // search_memories_hybrid, search_memories_semantic and match_agent_memory
  // all query mavis_agent_memories (768), never mavis_memory.
  //
  // mavis_memory holds 2633 rows of conversation history and was reachable by
  // nothing at all. It is now searched through match_operator_entries with
  // everything else, which is why its column was widened from 384 to 1536 —
  // one query embedding then serves every table rather than needing a second
  // call at a second width.
  memory:         { table: "mavis_memory",         bodyCol: "content" },
  agent_memories: { table: "mavis_agent_memories", bodyCol: "content", dims: 768 },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const userId: string = String(body.user_id ?? body.userId ?? "").trim();
    const scope: string = String(body.scope ?? "all").trim().toLowerCase();
    const batch = Math.min(Math.max(Number(body.batch ?? DEFAULT_BATCH), 1), MAX_BATCH);

    if (!userId) return json({ error: "user_id is required" }, 400);
    if (!embeddingKey()) {
      // Said plainly rather than reported as success with zero embedded, which
      // is what makes an empty vector column look like a working feature.
      return json({ error: "no embedding key configured (OPENAI_API / OPENAI_API_KEY)" }, 503);
    }

    const wanted = scope === "all" ? Object.keys(TABLES) : [scope].filter((k) => k in TABLES);
    if (wanted.length === 0) {
      return json({ error: `unknown scope "${scope}"`, scopes: Object.keys(TABLES) }, 400);
    }

    const report: Record<string, { embedded: number; failed: number; remaining: number }> = {};

    for (const key of wanted) {
      const { table, titleCol, bodyCol, dims } = TABLES[key];
      const cols = titleCol ? `id,${titleCol},${bodyCol}` : `id,${bodyCol}`;

      const { data: rows, error } = await supabase
        .from(table)
        .select(cols)
        .eq("user_id", userId)
        .is("embedding", null)
        .limit(batch);
      if (error) throw new Error(`${table}: ${error.message}`);

      let embedded = 0;
      let failed = 0;

      // `as unknown as` because the select list is built from variables:
      // supabase-js parses select strings at the type level and a dynamic
      // template yields ParserError rather than a row type, which a direct
      // cast is not allowed to bridge (TS2352). deno-check caught this; tsc
      // never sees this directory.
      for (const row of (rows ?? []) as unknown as Record<string, unknown>[]) {
        const text = embeddableText(titleCol ? row[titleCol] : "", row[bodyCol]);
        if (!text) {
          // Nothing to embed. Left NULL on purpose: marking it done would need
          // a sentinel vector, and a row with no text is not findable anyway.
          failed++;
          continue;
        }
        const vec = await embedText(text, dims);
        if (!vec) { failed++; continue; }

        const { error: upErr } = await supabase
          .from(table)
          .update({ embedding: vec })
          .eq("id", String(row.id))
          .eq("user_id", userId);
        if (upErr) { failed++; continue; }
        embedded++;
      }

      const { count } = await supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .is("embedding", null);

      report[key] = { embedded, failed, remaining: count ?? 0 };
    }

    const remaining = Object.values(report).reduce((n, r) => n + r.remaining, 0);
    return json({ ok: true, batch, report, remaining, done: remaining === 0 });
  } catch (err) {
    return json({ error: (err as Error)?.message ?? String(err) }, 500);
  }
});
