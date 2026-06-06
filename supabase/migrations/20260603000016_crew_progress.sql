-- Real-time crew agent progress events (Supabase Realtime enabled)
CREATE TABLE IF NOT EXISTS mavis_crew_progress (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid NOT NULL,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_role  text NOT NULL,
  event_type  text NOT NULL CHECK (event_type IN ('start','complete','error','synthesis')),
  content     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mavis_crew_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own crew progress"
  ON mavis_crew_progress FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_crew_progress_run
  ON mavis_crew_progress (run_id, created_at ASC);

-- Enable Realtime for live streaming
ALTER PUBLICATION supabase_realtime ADD TABLE mavis_crew_progress;
