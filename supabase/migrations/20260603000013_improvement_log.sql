-- mavis_improvement_log
-- Tracks each run of the self-improvement pipeline:
-- how many pairs were evaluated/passed, average quality score,
-- where the JSONL was stored, and whether Ollama was triggered.

CREATE TABLE IF NOT EXISTS mavis_improvement_log (
  id              uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid         REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  pairs_evaluated integer      DEFAULT 0,
  pairs_passed    integer      DEFAULT 0,
  avg_score       numeric(4,2) DEFAULT 0,
  jsonl_path      text,
  ollama_triggered boolean     DEFAULT false,
  created_at      timestamptz  DEFAULT now()
);

ALTER TABLE mavis_improvement_log ENABLE ROW LEVEL SECURITY;

-- Users can read and insert their own improvement log entries
DO $$ BEGIN
  CREATE POLICY "Users manage own improvement log"
    ON mavis_improvement_log
    FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Index for listing runs chronologically per user
DO $$ BEGIN
  CREATE INDEX idx_improvement_log_user_time
    ON mavis_improvement_log (user_id, created_at DESC);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Index for querying high-quality runs (dashboards / trend analysis)
DO $$ BEGIN
  CREATE INDEX idx_improvement_log_score
    ON mavis_improvement_log (user_id, avg_score DESC);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
