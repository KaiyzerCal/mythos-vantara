-- Enable pgvector (safe if already enabled)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add 768-dimensional embedding column to mavis_agent_memories (Gemini text-embedding-004)
ALTER TABLE mavis_agent_memories
  ADD COLUMN IF NOT EXISTS embedding vector(768);

-- IVFFlat index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS mavis_memories_embedding_idx
  ON mavis_agent_memories
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Semantic similarity search function
CREATE OR REPLACE FUNCTION search_memories_semantic(
  query_embedding vector(768),
  match_user_id   uuid,
  match_count     int DEFAULT 6
)
RETURNS TABLE (
  id            uuid,
  content       text,
  memory_type   text,
  tags          text[],
  importance    int,
  created_at    timestamptz,
  similarity    float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    content,
    memory_type,
    tags,
    importance,
    created_at,
    1 - (embedding <=> query_embedding) AS similarity
  FROM mavis_agent_memories
  WHERE user_id = match_user_id
    AND status = 'active'
    AND embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
