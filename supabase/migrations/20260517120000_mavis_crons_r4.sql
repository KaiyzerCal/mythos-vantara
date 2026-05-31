-- MAVIS Round-4 Cron Schedules
-- Adds pg_cron entries for all periodic MAVIS functions that weren't already scheduled.
-- Requires pg_cron and pg_net extensions enabled in Supabase Dashboard.
--
-- Uses current_setting('app.supabase_url') and current_setting('app.service_role_key')
-- which must be set via: ALTER DATABASE postgres SET app.supabase_url = '...';
--                         ALTER DATABASE postgres SET app.service_role_key = '...';
-- (Do this once in the Supabase SQL editor.)

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Morning brief — 06:00 UTC daily
--    Pushes the structured daily brief to Telegram with pattern alerts + operator prefs.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'mavis-morning-brief',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-morning-brief',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Nightly memory consolidation — 02:00 UTC daily
--    Reads unconsolidated mavis_memory, extracts knowledge + tacit, marks consolidated.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'mavis-consolidate',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-consolidate',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Spaced repetition check — 05:30 UTC daily
--    Surfaces notes due for review and sends reminders.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'mavis-spaced-repetition',
  '30 5 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-spaced-repetition',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Streak alerts — 08:00 UTC daily
--    Checks habit streaks and sends Telegram warnings before streaks break.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'mavis-streak-alerts',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-streak-alerts',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Periodic review — 03:00 UTC every Sunday
--    Weekly system review: goal progress, stalled quests, energy trends.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'mavis-periodic-review',
  '0 3 * * 0',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-periodic-review',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Self-reflection synthesis — 03:30 UTC every Sunday
--    Groups raw corrections, synthesizes durable rules, upserts to mavis_tacit.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'mavis-self-reflect',
  '30 3 * * 0',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-self-reflect',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify: SELECT jobname, schedule FROM cron.job ORDER BY jobname;
-- ─────────────────────────────────────────────────────────────────────────────
