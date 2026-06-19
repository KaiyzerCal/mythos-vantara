-- Agent execution traces: every ReAct loop action is recorded here
CREATE TABLE IF NOT EXISTS mavis_agent_traces (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id    text,
  iteration     integer DEFAULT 0,
  action_type   text NOT NULL,
  params        jsonb DEFAULT '{}',
  result        jsonb,
  ok            boolean DEFAULT true,
  duration_ms   integer,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mavis_agent_traces_user_idx
  ON mavis_agent_traces (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mavis_agent_traces_session_idx
  ON mavis_agent_traces (session_id, created_at DESC);

ALTER TABLE mavis_agent_traces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_traces_user" ON mavis_agent_traces FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
