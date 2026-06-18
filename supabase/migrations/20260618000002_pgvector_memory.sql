-- Enable pgvector for semantic memory search
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS vector; EXCEPTION WHEN others THEN NULL; END $$;

-- Add embedding column to mavis_memory for semantic similarity search
ALTER TABLE mavis_memory ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- IVFFlat index for cosine similarity (lists=100 is good for up to ~1M rows)
CREATE INDEX IF NOT EXISTS mavis_memory_embedding_idx
  ON mavis_memory USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- RPC for semantic similarity search used by mavis-memory-agent
CREATE OR REPLACE FUNCTION match_mavis_memories(
  query_embedding vector(1536),
  match_user_id   uuid,
  match_threshold float DEFAULT 0.7,
  match_count     int   DEFAULT 50
)
RETURNS TABLE (
  id               uuid,
  content          text,
  timestamp        bigint,
  created_at       timestamptz,
  tags             text[],
  importance_score int,
  role             text,
  similarity       float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    content,
    timestamp,
    created_at,
    tags,
    importance_score,
    role,
    1 - (embedding <=> query_embedding) AS similarity
  FROM mavis_memory
  WHERE user_id = match_user_id
    AND embedding IS NOT NULL
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
