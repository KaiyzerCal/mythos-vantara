-- ============================================================
-- 20260530000010_enhancements.sql
-- IVFFlat index, response feedback, LLM analytics,
-- memory decay function, provider stats view, custom skills
-- ============================================================

-- ----------------------------------------------------------
-- 1. IVFFlat vector index on mavis_notes
--    Improves KNN / cosine-similarity search past 200 notes
-- ----------------------------------------------------------
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS mavis_notes_embedding_ivfflat_idx
    ON mavis_notes USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
EXCEPTION WHEN undefined_table THEN NULL; WHEN others THEN NULL; END $$;

-- ----------------------------------------------------------
-- 2. Response feedback table
--    Thumbs up / down ratings on MAVIS messages
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS mavis_response_feedback (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id      text        NOT NULL,          -- client-side message ID
  conversation_id text,
  rating          smallint    NOT NULL CHECK (rating IN (-1, 1)),  -- -1 = thumbs down, 1 = thumbs up
  provider        text,                          -- which LLM answered
  mode            text,                          -- which MAVIS mode
  response_preview text,                         -- first 200 chars of the response
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE mavis_response_feedback ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "user own feedback" ON mavis_response_feedback FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_feedback_user ON mavis_response_feedback(user_id, created_at DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_feedback_rating ON mavis_response_feedback(user_id, rating);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ----------------------------------------------------------
-- 3. LLM call analytics table
--    Tracks provider, latency, tokens, and cost per AI call
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS mavis_llm_calls (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider            text        NOT NULL,      -- gemini | claude | openai | grok
  model               text,
  mode                text,                      -- MAVIS mode used
  prompt_tokens       int,
  completion_tokens   int,
  total_tokens        int,
  duration_ms         int,
  estimated_cost_usd  numeric(10,6),
  success             boolean     DEFAULT true,
  error_msg           text,
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE mavis_llm_calls ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "user own llm calls" ON mavis_llm_calls FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_llm_calls_user ON mavis_llm_calls(user_id, created_at DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_llm_calls_provider ON mavis_llm_calls(user_id, provider, created_at DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ----------------------------------------------------------
-- 4. Memory decay function
--    Marks old low-importance memories as archived
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION decay_old_memories(p_user_id uuid, p_days_threshold int DEFAULT 90)
RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE mavis_agent_memories
  SET status = 'archived',
      updated_at = now()
  WHERE user_id = p_user_id
    AND status = 'active'
    AND importance < 5
    AND created_at < now() - (p_days_threshold || ' days')::interval;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ----------------------------------------------------------
-- 5. Provider performance view
--    Aggregated stats for the analytics dashboard
-- ----------------------------------------------------------
CREATE OR REPLACE VIEW mavis_provider_stats AS
SELECT
  user_id,
  provider,
  mode,
  COUNT(*)                                    AS total_calls,
  ROUND(AVG(duration_ms))                     AS avg_latency_ms,
  ROUND(MIN(duration_ms))                     AS min_latency_ms,
  ROUND(MAX(duration_ms))                     AS max_latency_ms,
  ROUND(AVG(total_tokens))                    AS avg_tokens,
  SUM(total_tokens)                           AS total_tokens,
  ROUND(SUM(estimated_cost_usd)::numeric, 4)  AS total_cost_usd,
  COUNT(*) FILTER (WHERE success = false)     AS error_count,
  ROUND(100.0 * COUNT(*) FILTER (WHERE success) / NULLIF(COUNT(*),0), 1) AS success_rate_pct,
  MAX(created_at)                             AS last_used_at
FROM mavis_llm_calls
GROUP BY user_id, provider, mode;

-- ----------------------------------------------------------
-- 6. Skill editor table
--    User-defined custom skills stored in DB
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS mavis_custom_skills (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text        NOT NULL,
  description    text        NOT NULL,
  trigger_phrase text,                           -- optional keyword that activates this skill
  system_prompt  text        NOT NULL,           -- injected into MAVIS system prompt when active
  tools          text[]      DEFAULT '{}',       -- tool names this skill can use
  modes          text[]      DEFAULT '{}',       -- MAVIS modes where this skill is active
  enabled        boolean     DEFAULT true,
  version        int         DEFAULT 1,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),
  UNIQUE(user_id, name)
);

ALTER TABLE mavis_custom_skills ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "user own skills" ON mavis_custom_skills FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
