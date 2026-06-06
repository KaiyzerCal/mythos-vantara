-- MAVIS Crew Runs — stores each parallel multi-agent orchestration run

CREATE TABLE IF NOT EXISTS mavis_crew_runs (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid        REFERENCES auth.users NOT NULL,
  goal          text        NOT NULL,
  agent_count   integer     DEFAULT 0,
  agent_results jsonb       DEFAULT '[]',
  synthesis     text,
  duration_ms   integer,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE mavis_crew_runs ENABLE ROW LEVEL SECURITY;

-- Users can only see and manage their own runs
DO $$ BEGIN
  CREATE POLICY "Users manage own crew runs"
    ON mavis_crew_runs
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Fast lookups by user, latest-first (primary access pattern)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_mavis_crew_runs_user_created
    ON mavis_crew_runs (user_id, created_at DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- GIN index for querying inside agent_results JSONB (e.g. find runs by agent role)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_mavis_crew_runs_agent_results_gin
    ON mavis_crew_runs USING gin (agent_results);
EXCEPTION WHEN undefined_table THEN NULL; END $$;
