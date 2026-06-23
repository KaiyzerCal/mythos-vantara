-- Semantic memory search via pgvector
-- Adds embedding columns to mavis_memory and mavis_knowledge,
-- then creates RPC functions used by the Director's recall_memory tool.

-- Ensure pgvector is enabled (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to conversation memory
ALTER TABLE mavis_memory
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Add embedding column to knowledge base
ALTER TABLE mavis_knowledge
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- HNSW indexes — faster and more accurate than IVFFlat for this data size
-- (IVFFlat requires >list_count rows to build; HNSW works from day 1)
CREATE INDEX IF NOT EXISTS mavis_memory_embedding_hnsw
  ON mavis_memory USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS mavis_knowledge_embedding_hnsw
  ON mavis_knowledge USING hnsw (embedding vector_cosine_ops);

-- RPC: semantic search over conversation memory
-- Used by Director's recall_memory tool and autonomous runner's store step.
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(1536),
  match_user_id   uuid,
  match_count     int DEFAULT 10
)
RETURNS TABLE (
  content         text,
  role            text,
  timestamp       bigint,
  importance_score int,
  similarity      float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    content,
    role,
    timestamp,
    importance_score,
    1 - (embedding <=> query_embedding) AS similarity
  FROM mavis_memory
  WHERE user_id = match_user_id
    AND embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- RPC: semantic search over the knowledge base
-- Used by Director's recall_memory tool.
CREATE OR REPLACE FUNCTION match_knowledge(
  query_embedding vector(1536),
  match_user_id   uuid,
  match_count     int DEFAULT 5
)
RETURNS TABLE (
  title      text,
  content    text,
  category   text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    title,
    content,
    category,
    1 - (embedding <=> query_embedding) AS similarity
  FROM mavis_knowledge
  WHERE user_id = match_user_id
    AND embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
