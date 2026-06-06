-- MAVIS Automated Backup Infrastructure
-- Adds backup logging table and daily export cron job.

CREATE TABLE IF NOT EXISTS mavis_backup_log (
  id          BIGSERIAL PRIMARY KEY,
  run_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_count  INTEGER,
  total_rows  INTEGER,
  status      TEXT CHECK (status IN ('success','partial','failed')) DEFAULT 'success',
  details     JSONB DEFAULT '{}',
  duration_ms INTEGER
);

-- Daily export cron job (runs at 3 AM UTC)
-- Calls mavis-data-export with service role — backs up all users' data to storage.
DO $$
DECLARE
  fn_url TEXT;
  svc_key TEXT;
BEGIN
  fn_url  := current_setting('app.supabase_url', true) || '/functions/v1/mavis-data-export';
  svc_key := current_setting('app.service_role_key', true);

  -- Only schedule if pg_cron and pg_net are available
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') AND
     EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN

    PERFORM cron.schedule(
      'mavis-daily-backup',
      '0 3 * * *',  -- 3 AM UTC daily
      format(
        $$SELECT net.http_post(
          url     := %L,
          headers := jsonb_build_object('Authorization', 'Bearer ' || %L, 'Content-Type', 'application/json'),
          body    := '{"mode":"all"}'::jsonb
        )$$,
        fn_url, svc_key
      )
    );

  END IF;
END $$;

-- Storage bucket for backups (run in Supabase dashboard if bucket doesn't exist)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('mavis-backups', 'mavis-backups', false) ON CONFLICT DO NOTHING;

COMMENT ON TABLE mavis_backup_log IS 'Log of automated daily data exports. Files stored in mavis-backups storage bucket.';
