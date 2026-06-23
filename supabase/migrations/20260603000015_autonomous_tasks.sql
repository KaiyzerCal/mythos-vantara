-- Long-horizon autonomous task execution table
CREATE TABLE IF NOT EXISTS mavis_autonomous_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal          text NOT NULL,
  plan          jsonb NOT NULL DEFAULT '[]',   -- array of step objects
  current_step  int  NOT NULL DEFAULT 0,
  context       jsonb NOT NULL DEFAULT '{}',   -- accumulated context/memory across steps
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','paused','completed','failed')),
  result        text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

ALTER TABLE mavis_autonomous_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own autonomous tasks"
  ON mavis_autonomous_tasks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own autonomous tasks"
  ON mavis_autonomous_tasks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own autonomous tasks"
  ON mavis_autonomous_tasks FOR UPDATE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_autonomous_tasks_user_status
  ON mavis_autonomous_tasks (user_id, status, updated_at DESC);
