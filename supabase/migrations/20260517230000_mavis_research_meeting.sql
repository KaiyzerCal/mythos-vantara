-- meeting_notes table
CREATE TABLE IF NOT EXISTS meeting_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  meeting_date DATE,
  attendees TEXT[] DEFAULT '{}',
  decisions TEXT[] DEFAULT '{}',
  action_items JSONB DEFAULT '[]',
  key_points TEXT[] DEFAULT '{}',
  summary TEXT,
  raw_transcript TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE meeting_notes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users own meeting_notes" ON meeting_notes FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_meeting_notes_user_date ON meeting_notes(user_id, created_at DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- time_logs table
CREATE TABLE IF NOT EXISTS time_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  task_id UUID REFERENCES mavis_tasks(id) ON DELETE SET NULL,
  project TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE time_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users own time_logs" ON time_logs FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_time_logs_user_date ON time_logs(user_id, started_at DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;
