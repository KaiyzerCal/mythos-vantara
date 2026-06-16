-- Register mavis-so-scheduler as a pg_cron job (every 15 minutes)
-- Safe to re-run: unschedules first, then re-creates.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  PERFORM cron.unschedule('mavis-so-scheduler');
EXCEPTION WHEN others THEN NULL; END $$;

SELECT cron.schedule(
  'mavis-so-scheduler',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/mavis-so-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
