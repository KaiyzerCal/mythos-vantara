CREATE TABLE IF NOT EXISTS mavis_browser_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal          text NOT NULL,
  steps         jsonb NOT NULL DEFAULT '[]',
  current_step  int  NOT NULL DEFAULT 0,
  context       jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','completed','failed','paused')),
  result        text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mavis_browser_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own browser sessions"
  ON mavis_browser_sessions FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users insert own browser sessions"
  ON mavis_browser_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own browser sessions"
  ON mavis_browser_sessions FOR UPDATE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_browser_sessions_user_status
  ON mavis_browser_sessions (user_id, status, updated_at DESC);
