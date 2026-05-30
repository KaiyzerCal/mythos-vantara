-- health_metrics table (if not exists)
CREATE TABLE IF NOT EXISTS health_metrics (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  metric_date date NOT NULL,
  metric_type text NOT NULL,
  value numeric,
  unit text,
  source text DEFAULT 'manual',
  raw_data jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, metric_date, metric_type, source)
);
ALTER TABLE health_metrics ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='health_metrics' AND policyname='health_metrics_owner') THEN
    CREATE POLICY health_metrics_owner ON health_metrics FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- pg_cron jobs for daily sync (08:30 UTC)
SELECT cron.schedule('mavis-oura-daily', '30 8 * * *',
  $$SELECT net.http_post(url := current_setting('app.supabase_url') || '/functions/v1/mavis-oura-sync',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'), 'Content-Type', 'application/json'),
    body := '{}'::jsonb) AS request_id$$);

SELECT cron.schedule('mavis-strava-daily', '35 8 * * *',
  $$SELECT net.http_post(url := current_setting('app.supabase_url') || '/functions/v1/mavis-strava-sync',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'), 'Content-Type', 'application/json'),
    body := '{}'::jsonb) AS request_id$$);

SELECT cron.schedule('mavis-github-hourly', '0 * * * *',
  $$SELECT net.http_post(url := current_setting('app.supabase_url') || '/functions/v1/mavis-github-sync',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'), 'Content-Type', 'application/json'),
    body := '{}'::jsonb) AS request_id$$);
