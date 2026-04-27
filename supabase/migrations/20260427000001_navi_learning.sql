-- ── NAVI Learning System: Semantic Memory Search + Fine-tuning Support ─────────

-- Semantic similarity search for persona memories.
-- Scores by a weighted blend of cosine similarity (70%) and declared importance (30%)
-- so highly important memories surface even when not the closest semantic match.
CREATE OR REPLACE FUNCTION search_persona_memories(
  p_persona_id    UUID,
  p_user_id       UUID,
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.72,
  match_count     INT   DEFAULT 8
)
RETURNS TABLE(
  content      TEXT,
  memory_type  TEXT,
  importance   INT,
  similarity   FLOAT
)
LANGUAGE sql STABLE AS $$
  SELECT
    content,
    memory_type,
    importance,
    1 - (embedding <=> query_embedding) AS similarity
  FROM persona_memories
  WHERE
    persona_id = p_persona_id
    AND user_id = p_user_id
    AND embedding IS NOT NULL
    AND (1 - (embedding <=> query_embedding)) > match_threshold
  ORDER BY
    ((1 - (embedding <=> query_embedding)) * 0.7 + (importance::float / 10.0) * 0.3) DESC
  LIMIT match_count;
$$;

-- Fine-tuning lifecycle columns on personas
ALTER TABLE personas ADD COLUMN IF NOT EXISTS finetune_job_id   TEXT;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS finetune_status   TEXT NOT NULL DEFAULT 'none';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS finetune_model    TEXT;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS last_finetuned_at TIMESTAMPTZ;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS finetune_examples INT  DEFAULT 0;

-- Quality score on conversations — used later to filter training data
ALTER TABLE persona_conversations ADD COLUMN IF NOT EXISTS quality_score FLOAT;
