-- Finance, scheduling, and education data tables
-- Era.app financial cache, Reclaim.ai schedule blocks, Khanmigo tutoring sessions

-- Financial data cache
CREATE TABLE IF NOT EXISTS era_financial_cache (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  cache_type text NOT NULL, -- 'accounts', 'transactions', 'goals', 'net_worth'
  data jsonb NOT NULL DEFAULT '{}',
  period_start date,
  period_end date,
  synced_at timestamptz DEFAULT now(),
  UNIQUE(user_id, cache_type, period_start)
);
ALTER TABLE era_financial_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own finance cache" ON era_financial_cache FOR ALL USING (auth.uid() = user_id);

-- Reclaim.ai schedule blocks
CREATE TABLE IF NOT EXISTS reclaim_schedule_blocks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  reclaim_task_id text,
  title text NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  block_type text DEFAULT 'task',
  health_triggered boolean DEFAULT false,
  synced_at timestamptz DEFAULT now()
);
ALTER TABLE reclaim_schedule_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own schedule" ON reclaim_schedule_blocks FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_reclaim_user_time ON reclaim_schedule_blocks(user_id, start_time);

-- Khanmigo Socratic tutoring sessions
CREATE TABLE IF NOT EXISTS tutoring_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  subject text NOT NULL,
  topic_id text,
  messages jsonb DEFAULT '[]',
  current_problem text,
  solved boolean DEFAULT false,
  hints_used int DEFAULT 0,
  time_spent_seconds int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE tutoring_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own tutoring" ON tutoring_sessions FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_tutoring_user ON tutoring_sessions(user_id, created_at DESC);
