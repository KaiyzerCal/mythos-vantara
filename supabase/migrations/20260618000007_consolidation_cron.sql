DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_cron; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_net;  EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN PERFORM cron.unschedule('mavis-memory-consolidation'); EXCEPTION WHEN others THEN NULL; END $$;

SELECT cron.schedule(
  'mavis-memory-consolidation',
  '0 3 * * *',  -- 3 AM UTC daily
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-consolidate',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{"action":"consolidate_memories"}'::jsonb
  );
  $$
);
