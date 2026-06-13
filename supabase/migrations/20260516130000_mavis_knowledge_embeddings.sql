-- pgvector semantic search for MAVIS Knowledge Graph
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- 1. Enable pgvector extension (already available on Supabase hosted)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add embedding column to mavis_notes
ALTER TABLE mavis_notes
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- 3. Cosine similarity search function
--    Called by mavis-knowledge edge function and telegram-webhook
CREATE OR REPLACE FUNCTION match_mavis_notes(
  query_embedding vector(1536),
  match_user_id   uuid,
  match_threshold float DEFAULT 0.45,
  match_count     int   DEFAULT 5
)
RETURNS TABLE (
  id         uuid,
  title      text,
  content    text,
  tags       text[],
  updated_at timestamptz,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    title,
    content,
    tags,
    updated_at,
    1 - (embedding <=> query_embedding) AS similarity
  FROM mavis_notes
  WHERE user_id = match_user_id
    AND embedding IS NOT NULL
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- 4. IVFFlat index for fast search (effective once you have >200 notes)
--    Supabase requires running ANALYZE after inserting embeddings.
--    Uncomment if you have many notes; skip for small vaults.
-- CREATE INDEX IF NOT EXISTS mavis_notes_embedding_idx
--   ON mavis_notes USING ivfflat (embedding vector_cosine_ops)
--   WITH (lists = 100);
