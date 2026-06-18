-- Persistent multi-session plans (long-horizon goals with step tracking)
CREATE TABLE IF NOT EXISTS mavis_plans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title                 text NOT NULL,
  goal                  text NOT NULL,
  steps                 jsonb NOT NULL DEFAULT '[]',
  current_step          integer DEFAULT 0,
  status                text DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'abandoned')),
  context               text DEFAULT '',
  last_session_summary  text DEFAULT '',
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

ALTER TABLE mavis_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mavis_plans_user" ON mavis_plans FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
