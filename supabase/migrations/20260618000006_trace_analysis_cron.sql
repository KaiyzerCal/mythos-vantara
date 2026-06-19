-- Daily agent trace analysis: MAVIS learns from its own execution patterns
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_cron;  EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_net;   EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN PERFORM cron.unschedule('mavis-trace-analysis'); EXCEPTION WHEN others THEN NULL; END $$;

SELECT cron.schedule(
  'mavis-trace-analysis',
  '0 4 * * *',  -- 4 AM UTC daily
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-self-improve',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{"action":"analyze_traces","lookback_hours":24}'::jsonb
  );
  $$
);
