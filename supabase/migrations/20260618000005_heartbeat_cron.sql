-- Schedule MAVIS heartbeat every hour via pg_cron + pg_net
-- (same pattern as mavis-so-scheduler migration)
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_cron;  EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_net;   EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN PERFORM cron.unschedule('mavis-heartbeat'); EXCEPTION WHEN others THEN NULL; END $$;

SELECT cron.schedule(
  'mavis-heartbeat',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-heartbeat',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
