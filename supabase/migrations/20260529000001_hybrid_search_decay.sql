-- Hybrid search + episodic memory decay for mavis_agent_memories

-- 1. Add tsvector column for BM25-style full-text search
ALTER TABLE mavis_agent_memories
  ADD COLUMN IF NOT EXISTS fts tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS mavis_memories_fts_idx
  ON mavis_agent_memories USING gin(fts);

-- 2. Add episodic memory decay tracking columns
ALTER TABLE mavis_agent_memories
  ADD COLUMN IF NOT EXISTS last_accessed_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS access_count int DEFAULT 0 NOT NULL;

-- 3. Hybrid search function: BM25 + pgvector cosine + RRF merge + temporal decay
CREATE OR REPLACE FUNCTION search_memories_hybrid(
  query_embedding  vector(768),
  query_text       text,
  match_user_id    uuid,
  match_count      int DEFAULT 6
)
RETURNS TABLE (
  id            uuid,
  content       text,
  memory_type   text,
  tags          text[],
  importance    int,
  created_at    timestamptz,
  score         float
)
LANGUAGE sql STABLE
AS $$
  WITH semantic AS (
    SELECT id,
           row_number() OVER (ORDER BY embedding <=> query_embedding) AS rank
    FROM mavis_agent_memories
    WHERE user_id = match_user_id
      AND status  = 'active'
      AND embedding IS NOT NULL
    ORDER BY embedding <=> query_embedding
    LIMIT 20
  ),
  keyword AS (
    SELECT id,
           row_number() OVER (
             ORDER BY ts_rank_cd(fts, plainto_tsquery('english', query_text)) DESC
           ) AS rank
    FROM mavis_agent_memories
    WHERE user_id = match_user_id
      AND status  = 'active'
      AND fts @@ plainto_tsquery('english', query_text)
    ORDER BY ts_rank_cd(fts, plainto_tsquery('english', query_text)) DESC
    LIMIT 20
  ),
  rrf AS (
    SELECT coalesce(s.id, k.id) AS id,
           coalesce(1.0 / (60.0 + s.rank), 0.0) +
           coalesce(1.0 / (60.0 + k.rank), 0.0) AS rrf_score
    FROM semantic s FULL OUTER JOIN keyword k ON s.id = k.id
  )
  SELECT
    m.id,
    m.content,
    m.memory_type,
    m.tags,
    m.importance,
    m.created_at,
    -- decay: recency × engagement bonus
    r.rrf_score
      * (0.6 + 0.4 * exp(
          -extract(epoch from (now() - coalesce(m.last_accessed_at, m.created_at))) / 2592000.0
        ))
      * ln(1.0 + coalesce(m.access_count, 0))
      AS score
  FROM rrf r
  JOIN mavis_agent_memories m ON r.id = m.id
  ORDER BY score DESC
  LIMIT match_count;
$$;

-- 4. Update access tracking when a memory is retrieved
CREATE OR REPLACE FUNCTION bump_memory_access(memory_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE mavis_agent_memories
  SET last_accessed_at = now(),
      access_count     = coalesce(access_count, 0) + 1
  WHERE id = memory_id;
$$;

-- 5. Also add tsvector + decay to mavis_notes (knowledge graph) for consistency
ALTER TABLE mavis_notes
  ADD COLUMN IF NOT EXISTS fts tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS mavis_notes_fts_idx
  ON mavis_notes USING gin(fts);

ALTER TABLE mavis_notes
  ADD COLUMN IF NOT EXISTS last_accessed_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS access_count int DEFAULT 0 NOT NULL;
