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
  /**
   * Default "id". mavis_user_profile is one row per operator, keyed by
   * user_id, with no id column at all — selecting/updating on "id"
   * unconditionally 400s on that table specifically.
   */
  idCol?: string;
  /**
   * bodyCol is jsonb, not text. Two things change: the blank-row filter
   * can't use a regex match (`jsonb ~ text` doesn't exist as an operator —
   * found this by running the backfill against mavis_calls.transcript, which
   * failed outright rather than just embedding nothing), so it falls back to
   * an IS NOT NULL check instead; and the value arrives as a parsed object,
   * not a string, so it needs JSON.stringify rather than embeddableText's
   * plain concatenation (which would otherwise embed the literal text
   * "[object Object]").
   */
  bodyIsJson?: boolean;
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

  // Curated tier — see the 20260830190000 migration for why these 28 and not
  // the rest of the app. mavis_persona_memory and mavis_council_memory
  // already have active writers (mavis-chat, mavis-council-heartbeat); an
  // entry here only catches whatever those miss, same resumable semantics
  // as every other row in this map.
  mavis_telos: { table: "mavis_telos", titleCol: "mission", bodyCol: "current_state" },
  mavis_narrative: { table: "mavis_narrative", titleCol: "identity_summary", bodyCol: "narrative" },
  mavis_user_model: { table: "mavis_user_model", titleCol: "personality_summary", bodyCol: "raw_synthesis" },
  mavis_user_profile: { table: "mavis_user_profile", titleCol: "profile_md", bodyCol: "key_context", idCol: "user_id" },
  mavis_plans: { table: "mavis_plans", titleCol: "title", bodyCol: "summary" },
  mavis_playbooks: { table: "mavis_playbooks", titleCol: "name", bodyCol: "description" },
  mavis_strategy_memos: { table: "mavis_strategy_memos", titleCol: "question", bodyCol: "synthesis" },
  mavis_crew_runs: { table: "mavis_crew_runs", titleCol: "goal", bodyCol: "synthesis" },
  mavis_council_discourse: { table: "mavis_council_discourse", titleCol: "topic", bodyCol: "synthesis" },
  mavis_relationship_health: { table: "mavis_relationship_health", titleCol: "contact_name", bodyCol: "notes" },
  mavis_leads: { table: "mavis_leads", titleCol: "company_name", bodyCol: "research_summary" },
  mavis_outreach_drafts: { table: "mavis_outreach_drafts", titleCol: "contact_name", bodyCol: "drafted_message" },
  mavis_meeting_preps: { table: "mavis_meeting_preps", titleCol: "event_title", bodyCol: "prep_brief" },
  mavis_insights: { table: "mavis_insights", titleCol: "title", bodyCol: "content" },
  mavis_predictions: { table: "mavis_predictions", titleCol: "title", bodyCol: "content" },
  mavis_causal_chains: { table: "mavis_causal_chains", titleCol: "cause", bodyCol: "description" },
  mavis_thought_chains: { table: "mavis_thought_chains", titleCol: "goal", bodyCol: "conclusion" },
  mavis_outcome_events: { table: "mavis_outcome_events", titleCol: "prediction_text", bodyCol: "actual_outcome" },
  watchtower_briefs: { table: "watchtower_briefs", titleCol: "summary", bodyCol: "content" },
  mavis_daily_briefs: { table: "mavis_daily_briefs", bodyCol: "brief_text" },
  mavis_agent_briefs: { table: "mavis_agent_briefs", bodyCol: "summary" },
  mavis_calls: { table: "mavis_calls", titleCol: "purpose", bodyCol: "transcript", bodyIsJson: true },
  receptionist_calls: { table: "receptionist_calls", titleCol: "summary", bodyCol: "transcript" },
  video_segments: { table: "video_segments", bodyCol: "transcript_text" },
  chat_attachments: { table: "chat_attachments", titleCol: "file_name", bodyCol: "extracted_text" },
  mavis_persona_memory: { table: "mavis_persona_memory", titleCol: "role", bodyCol: "content" },
  mavis_council_memory: { table: "mavis_council_memory", bodyCol: "content" },
  persona_memories: { table: "persona_memories", titleCol: "memory_type", bodyCol: "content" },
};

/**
 * Narrow a query to rows that can actually produce an embedding.
 *
 * Without this the backfill cannot finish. 89 of mavis_memory's rows have
 * empty content, and an unordered scan returns them first — so a run spent
 * most of its batch re-reading the same dead rows (a batch of 100 embedded
 * about 36), and `remaining` could never fall below 89, leaving the cron to
 * spin forever on work it was never able to complete.
 *
 * Matched against a blank pattern rather than compared to '': `content <> ''`
 * is true for "   ", so a whitespace-only row would still be selected on
 * every run and would re-break termination the same way. The regex covers
 * empty, whitespace-only and NULL in one filter — `NULL !~ ...` is NULL,
 * which PostgREST drops.
 *
 * A titled table can still qualify on its title alone, which is why those
 * use `or` rather than testing the body by itself. Both forms were checked
 * against the running PostgREST before being relied on here.
 */
const BLANK = "^[[:space:]]*$";

// deno-lint-ignore no-explicit-any
function onlyEmbeddable(q: any, titleCol: string | undefined, bodyCol: string, bodyIsJson?: boolean): any {
  // jsonb has no `~` (regex match) operator, so the blank-pattern filter
  // that works for every text column 400s outright on one. IS NOT NULL is
  // the closest equivalent PostgREST offers for jsonb — it won't catch an
  // empty object/array the way the regex catches whitespace-only text, but
  // it does exclude true NULLs, which is what makes the count in the second
  // call agree with what the select actually returned.
  const bodyClause = bodyIsJson ? `${bodyCol}.not.is.null` : `${bodyCol}.not.match.${BLANK}`;
  if (titleCol) return q.or(`${titleCol}.not.match.${BLANK},${bodyClause}`);
  return bodyIsJson ? q.not(bodyCol, "is", null) : q.not(bodyCol, "match", BLANK);
}

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
      const { table, titleCol, bodyCol, dims, bodyIsJson } = TABLES[key];
      const idCol = TABLES[key].idCol ?? "id";
      const cols = titleCol ? `${idCol},${titleCol},${bodyCol}` : `${idCol},${bodyCol}`;

      const { data: rows, error } = await onlyEmbeddable(
        supabase.from(table).select(cols).eq("user_id", userId).is("embedding", null),
        titleCol,
        bodyCol,
        bodyIsJson,
      ).limit(batch);
      if (error) throw new Error(`${table}: ${error.message}`);

      let embedded = 0;
      let failed = 0;

      // `as unknown as` because the select list is built from variables:
      // supabase-js parses select strings at the type level and a dynamic
      // template yields ParserError rather than a row type, which a direct
      // cast is not allowed to bridge (TS2352). deno-check caught this; tsc
      // never sees this directory.
      for (const row of (rows ?? []) as unknown as Record<string, unknown>[]) {
        // jsonb comes back parsed, not stringified — embeddableText's plain
        // concatenation would otherwise embed the literal text
        // "[object Object]" rather than anything the row actually says.
        const body = bodyIsJson ? JSON.stringify(row[bodyCol] ?? "") : row[bodyCol];
        const text = embeddableText(titleCol ? row[titleCol] : "", body);
        if (!text || text === '""' || text === "{}" || text === "[]") {
          // onlyEmbeddable excludes blank rows at the query level, so this is
          // a backstop for anything that slips past it — a row emptied
          // between the select and this loop, or a jsonb value that
          // stringifies to an empty shape IS NOT NULL can't see. Left NULL
          // on purpose: marking it done would need a sentinel vector, and a
          // row with no text is not findable anyway.
          failed++;
          continue;
        }
        const vec = await embedText(text, dims);
        if (!vec) { failed++; continue; }

        const { error: upErr } = await supabase
          .from(table)
          .update({ embedding: vec })
          .eq(idCol, String(row[idCol]))
          .eq("user_id", userId);
        if (upErr) { failed++; continue; }
        embedded++;
      }

      // Counted through the same filter as the select. If it were not, the
      // rows this can never embed would hold `remaining` above zero and
      // `done` would never become true.
      const { count } = await onlyEmbeddable(
        supabase
          .from(table)
          .select(idCol, { count: "exact", head: true })
          .eq("user_id", userId)
          .is("embedding", null),
        titleCol,
        bodyCol,
        bodyIsJson,
      );

      report[key] = { embedded, failed, remaining: count ?? 0 };
    }

    const remaining = Object.values(report).reduce((n, r) => n + r.remaining, 0);
    return json({ ok: true, batch, report, remaining, done: remaining === 0 });
  } catch (err) {
    return json({ error: (err as Error)?.message ?? String(err) }, 500);
  }
});
