-- Schedule mavis-dream (three-phase memory consolidation) nightly at 03:30 UTC.
-- Light phase: dedup recent memories
-- REM phase:   detect cross-session patterns → mavis_knowledge
-- Deep phase:  time-based importance decay + archive stale memories
-- Runs 30 min after mavis-consolidate (03:00) to avoid contention.

DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_cron; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_net;  EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN PERFORM cron.unschedule('mavis-dream-nightly'); EXCEPTION WHEN others THEN NULL; END $$;

SELECT cron.schedule(
  'mavis-dream-nightly',
  '30 3 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-dream',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{"phase":"all"}'::jsonb
  );
  $$
);
