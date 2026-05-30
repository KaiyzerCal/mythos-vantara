-- MAVIS Round-3 Cron Schedules
-- Adds pg_cron entries for: daily-notes, quest-nudge, tacit-prune
-- Requires pg_cron and pg_net extensions to be enabled in Supabase Dashboard.
-- Run in Supabase SQL Editor once after deploying the new edge functions.
--
-- NOTE: Replace 'https://YOUR_PROJECT_REF.supabase.co' with your actual project URL
--       if pg_net is used. Otherwise Supabase cron jobs call edge functions via
--       the internal HTTP endpoint automatically.

-- Enable required extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Daily auto-journal — 22:00 UTC (end of day synthesis)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'mavis-daily-notes',
  '0 22 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-daily-notes',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Quest deadline nudge — 08:00 and 18:00 UTC
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'mavis-quest-nudge-morning',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-quest-nudge',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'mavis-quest-nudge-evening',
  '0 18 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-quest-nudge',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Tacit memory pruner — Sundays at 03:00 UTC
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'mavis-tacit-prune',
  '0 3 * * 0',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-tacit-prune',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify scheduled jobs
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT jobname, schedule, command FROM cron.job ORDER BY jobname;
