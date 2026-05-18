-- Morning digest logs
CREATE TABLE IF NOT EXISTS morning_digest_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  digest_date date NOT NULL DEFAULT CURRENT_DATE,
  content text,
  quality_score numeric,
  delivery_method text DEFAULT 'telegram',
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, digest_date)
);
ALTER TABLE morning_digest_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='morning_digest_logs' AND policyname='digest_owner') THEN
    CREATE POLICY digest_owner ON morning_digest_logs FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- pg_cron: 07:00 UTC daily
SELECT cron.schedule('mavis-morning-digest', '0 7 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/mavis-morning-digest',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb
  ) AS request_id$$);
