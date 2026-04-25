-- Migration 2: persona_memories table
-- Requires pgvector extension for semantic similarity search
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE persona_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID REFERENCES personas(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL,
  content TEXT NOT NULL,
  importance INTEGER DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_recalled_at TIMESTAMPTZ
);

ALTER TABLE persona_memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their persona memories" ON persona_memories
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX ON persona_memories USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
