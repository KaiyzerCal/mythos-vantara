-- NORA content pipeline queue
CREATE TABLE IF NOT EXISTS nora_content_queue (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  platform text NOT NULL,
  content text NOT NULL,
  hashtags text[],
  scheduled_for timestamptz,
  posted_at timestamptz,
  status text NOT NULL DEFAULT 'draft',
  performance_data jsonb DEFAULT '{}',
  ai_generated boolean DEFAULT true,
  source_topic text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE nora_content_queue ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own nora content" ON nora_content_queue FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE INDEX idx_nora_content_user ON nora_content_queue(user_id, scheduled_for);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Screenpipe memory sync log
CREATE TABLE IF NOT EXISTS screenpipe_sync_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  synced_at timestamptz DEFAULT now(),
  items_synced int DEFAULT 0,
  memories_created int DEFAULT 0,
  context_window_minutes int DEFAULT 30
);
ALTER TABLE screenpipe_sync_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own screenpipe log" ON screenpipe_sync_log FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Wearable overlay history
CREATE TABLE IF NOT EXISTS wearable_overlay_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  device_type text NOT NULL,
  content text NOT NULL,
  overlay_type text DEFAULT 'ambient',
  displayed_at timestamptz DEFAULT now(),
  duration_ms int
);
ALTER TABLE wearable_overlay_history ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own overlay history" ON wearable_overlay_history FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
