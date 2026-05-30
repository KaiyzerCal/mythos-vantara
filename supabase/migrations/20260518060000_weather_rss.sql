-- RSS feeds table
CREATE TABLE IF NOT EXISTS rss_feeds (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  url text NOT NULL,
  is_active boolean DEFAULT true,
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, url)
);
ALTER TABLE rss_feeds ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='rss_feeds' AND policyname='rss_feeds_owner') THEN
DO $$ BEGIN
      CREATE POLICY rss_feeds_owner ON rss_feeds FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  END IF;
END $$;

-- pg_cron: HN digest at 08:00 UTC daily
SELECT cron.schedule('mavis-hn-daily', '0 8 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/mavis-hn-digest',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb
  ) AS request_id$$);
