-- Video generation job tracking
CREATE TABLE IF NOT EXISTS mavis_video_jobs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  prompt text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  request_id text,
  operation_name text,
  video_url text,
  duration_seconds int,
  aspect_ratio text DEFAULT '16:9',
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  error_message text
);
ALTER TABLE mavis_video_jobs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own video jobs" ON mavis_video_jobs FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE INDEX idx_video_jobs_user ON mavis_video_jobs(user_id, created_at DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;
