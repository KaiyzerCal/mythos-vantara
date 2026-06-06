-- Schedule mavis-ambient-monitor to run every 5 minutes via pg_cron + pg_net
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN others THEN NULL; END $$;

-- Remove existing job if it exists, then re-create cleanly
DO $$ BEGIN
  PERFORM cron.unschedule('mavis-ambient-monitor');
EXCEPTION WHEN others THEN NULL; END $$;

SELECT cron.schedule(
  'mavis-ambient-monitor',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/mavis-ambient-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
