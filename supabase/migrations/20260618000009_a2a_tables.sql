-- mavis_a2a_tasks: stores inbound A2A task delegations received by MAVIS
CREATE TABLE IF NOT EXISTS mavis_a2a_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id text,
  calling_agent_url text,
  skill_id text NOT NULL,
  input jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  result jsonb,
  error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE mavis_a2a_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "a2a_tasks_user" ON mavis_a2a_tasks
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for efficient per-user task lookups
CREATE INDEX IF NOT EXISTS mavis_a2a_tasks_user_status_idx
  ON mavis_a2a_tasks (user_id, status, created_at DESC);
