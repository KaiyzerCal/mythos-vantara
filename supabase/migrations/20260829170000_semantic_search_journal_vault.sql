-- Semantic search over the operator's own writing.
--
-- Keyword search finds entries that share words with the question. It cannot
-- connect "my custody case" to an entry titled "Joanna's Timesharing
-- Violation". This adds the embedding column those two tables need, plus one
-- function to search them.
--
-- Scope is deliberately journal_entries and vault_entries only — 65 and 97
-- rows, where the reported failures actually happened. Widening later is one
-- more ALTER each; widening now multiplies the backfill for no evidence.
--
-- Every statement follows the four rules in CLAUDE.md:
--
--  1. lock_timeout is set transaction-locally with set_config(..., true)
--     rather than a session-level SET. A session SET can land on a different
--     backend through the transaction pooler and silently protect nothing.
--  2. Nothing references auth.users. These are plain nullable columns on
--     tables that already exist; no foreign key, no trigger on a hot table.
--  3. Re-runnable. ADD COLUMN IF NOT EXISTS and CREATE OR REPLACE, so a
--     lock-timeout failure can simply be run again with no cleanup.
--  4. ADD COLUMN with no default and no NOT NULL is a catalogue-only change
--     in Postgres 11+ — it does not rewrite the table, so it holds its
--     ACCESS EXCLUSIVE lock for microseconds rather than for a table scan.
--
-- No vector index on purpose. ivfflat needs training data it does not have at
-- 162 rows, and a sequential scan over 162 vectors is already instant. Add
-- HNSW if these tables reach the tens of thousands — the same call the
-- full-text search made about a GIN index.

BEGIN;
SELECT set_config('lock_timeout', '3s', true);
SELECT set_config('statement_timeout', '60s', true);

ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.vault_entries   ADD COLUMN IF NOT EXISTS embedding vector(1536);

COMMIT;

-- Nearest neighbours across both tables in one round trip.
--
-- Returns a shape appSearch can merge with its keyword hits directly. The
-- 1 - (a <=> b) form turns cosine distance into a similarity, so higher is
-- better and the number reads the way a caller expects.
--
-- SECURITY INVOKER (the default): callers are edge functions holding the
-- service role, and p_user_id is applied as a filter regardless, so a row
-- can never be returned for the wrong operator.
CREATE OR REPLACE FUNCTION public.match_operator_entries(
  p_user_id uuid,
  p_query   vector(1536),
  p_count   int DEFAULT 8,
  p_scope   text DEFAULT 'all'
)
RETURNS TABLE (
  kind       text,
  id         uuid,
  title      text,
  content    text,
  category   text,
  created_at timestamptz,
  similarity double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT * FROM (
    SELECT 'journal'::text, j.id, j.title, j.content, j.category, j.created_at,
           1 - (j.embedding <=> p_query) AS similarity
    FROM public.journal_entries j
    WHERE j.user_id = p_user_id
      AND j.embedding IS NOT NULL
      AND p_scope IN ('all', 'journal')
    UNION ALL
    SELECT 'vault'::text, v.id, v.title, v.content, v.category, v.created_at,
           1 - (v.embedding <=> p_query) AS similarity
    FROM public.vault_entries v
    WHERE v.user_id = p_user_id
      AND v.embedding IS NOT NULL
      AND p_scope IN ('all', 'vault')
  ) hits
  ORDER BY hits.similarity DESC
  LIMIT greatest(p_count, 0);
$$;

-- ── Extended to quests, meeting notes and notebooks ────────────────────────
-- Same reasoning, same rules. Appended rather than written as a second file
-- so the whole semantic-search schema reads in one place; every statement is
-- still individually re-runnable.

BEGIN;
SELECT set_config('lock_timeout', '3s', true);
SELECT set_config('statement_timeout', '60s', true);

ALTER TABLE public.quests        ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.meeting_notes ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE public.notebooks     ADD COLUMN IF NOT EXISTS embedding vector(1536);

COMMIT;

-- Five tables now. The explicit column aliases in the first UNION branch are
-- load-bearing: without `AS similarity` the subquery's expression column is
-- unnamed and `ORDER BY hits.similarity` fails to plan, which aborted the
-- first attempt at this.
--
-- meeting_notes and notebooks have no category column, so they select NULL
-- into that position rather than inventing one.
CREATE OR REPLACE FUNCTION public.match_operator_entries(
  p_user_id uuid, p_query vector(1536), p_count int DEFAULT 8, p_scope text DEFAULT 'all'
)
RETURNS TABLE (kind text, id uuid, title text, content text,
               category text, created_at timestamptz, similarity double precision)
LANGUAGE sql STABLE AS $$
  SELECT * FROM (
    SELECT 'journal'::text AS kind, j.id AS id, j.title AS title, j.content AS content,
           j.category AS category, j.created_at AS created_at,
           1 - (j.embedding <=> p_query) AS similarity
    FROM public.journal_entries j
    WHERE j.user_id = p_user_id AND j.embedding IS NOT NULL AND p_scope IN ('all','journal')
    UNION ALL
    SELECT 'vault'::text, v.id, v.title, v.content, v.category, v.created_at,
           1 - (v.embedding <=> p_query)
    FROM public.vault_entries v
    WHERE v.user_id = p_user_id AND v.embedding IS NOT NULL AND p_scope IN ('all','vault')
    UNION ALL
    SELECT 'quests'::text, q.id, q.title, q.description, q.category, q.created_at,
           1 - (q.embedding <=> p_query)
    FROM public.quests q
    WHERE q.user_id = p_user_id AND q.embedding IS NOT NULL AND p_scope IN ('all','quests')
    UNION ALL
    SELECT 'meeting_notes'::text, m.id, m.title, m.summary, NULL::text, m.created_at,
           1 - (m.embedding <=> p_query)
    FROM public.meeting_notes m
    WHERE m.user_id = p_user_id AND m.embedding IS NOT NULL AND p_scope IN ('all','meeting_notes')
    UNION ALL
    SELECT 'notebooks'::text, n.id, n.title, n.description, NULL::text, n.created_at,
           1 - (n.embedding <=> p_query)
    FROM public.notebooks n
    WHERE n.user_id = p_user_id AND n.embedding IS NOT NULL AND p_scope IN ('all','notebooks')
  ) hits
  ORDER BY hits.similarity DESC
  LIMIT greatest(p_count, 0);
$$;
