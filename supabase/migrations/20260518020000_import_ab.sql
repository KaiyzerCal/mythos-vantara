-- Import jobs tracker
CREATE TABLE IF NOT EXISTS mavis_import_jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source      TEXT NOT NULL CHECK (source IN ('notion','obsidian','markdown','readwise','csv')),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  total       INT DEFAULT 0,
  imported    INT DEFAULT 0,
  skipped     INT DEFAULT 0,
  error       TEXT,
  started_at  TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ
);
ALTER TABLE mavis_import_jobs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users see own imports" ON mavis_import_jobs FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A/B testing for social posts
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mavis_social_posts' AND column_name='ab_group') THEN
    ALTER TABLE mavis_social_posts ADD COLUMN ab_group TEXT CHECK (ab_group IN ('A','B'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mavis_social_posts' AND column_name='ab_test_id') THEN
    ALTER TABLE mavis_social_posts ADD COLUMN ab_test_id UUID;
  END IF;
END $$;

-- Google Calendar integration key via mavis_user_integrations (no schema change needed,
-- just document that provider='google_calendar', key_name in ('access_token','calendar_id'))

-- Cron: achievement check after key events (called programmatically, no cron needed)
-- Cron: quest-to-calendar sync daily at 08:00 UTC
SELECT cron.schedule('mavis-quest-calendar', '0 8 * * *', $$
  SELECT net.http_post(url := current_setting('app.supabase_url') || '/functions/v1/mavis-quest-calendar',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body := '{"action":"push"}'::jsonb);
$$);
