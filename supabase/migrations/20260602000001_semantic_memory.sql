-- ============================================================
-- MAVIS Semantic Memory — pgvector embeddings on mavis_memory
-- Enables semantic similarity search instead of keyword-only
-- ============================================================

-- Enable pgvector (no-op if already enabled)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column (384 dims = Supabase gte-small model, self-hosted)
ALTER TABLE mavis_memory
  ADD COLUMN IF NOT EXISTS embedding vector(384);

-- Semantic search index (ivfflat for approximate nearest-neighbor)
CREATE INDEX IF NOT EXISTS mavis_memory_embedding_idx
  ON mavis_memory USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

-- Semantic search RPC — called by mavis-memory-embed
CREATE OR REPLACE FUNCTION search_mavis_memories(
  query_embedding vector(384),
  match_user_id   UUID,
  match_threshold FLOAT   DEFAULT 0.65,
  match_count     INTEGER DEFAULT 12
)
RETURNS TABLE (
  id               BIGINT,
  content          TEXT,
  role             TEXT,
  importance_score INTEGER,
  created_at       TIMESTAMPTZ,
  similarity       FLOAT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.content,
    m.role,
    m.importance_score,
    m.created_at,
    ROUND((1 - (m.embedding <=> query_embedding))::NUMERIC, 4)::FLOAT AS similarity
  FROM mavis_memory m
  WHERE m.user_id = match_user_id
    AND m.embedding IS NOT NULL
    AND (1 - (m.embedding <=> query_embedding)) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Track memory embedding jobs
CREATE TABLE IF NOT EXISTS mavis_memory_embed_queue (
  id         BIGSERIAL PRIMARY KEY,
  memory_id  BIGINT NOT NULL,
  user_id    UUID   NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
