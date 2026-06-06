-- MAVIS Round-5 Cron Schedules
-- Adds pg_cron entries for mavis-pattern-insights (weekly) and mavis-social-scheduler (hourly).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Pattern insights — 04:00 UTC every Monday
--    Runs behavioral analysis for all users, upserts to mavis_insights.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'mavis-pattern-insights',
  '0 4 * * 1',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-pattern-insights',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Social scheduler — every hour
--    Publishes scheduled/queued posts in mavis_social_posts via Nora.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'mavis-social-scheduler',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-social-scheduler',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Verify: SELECT jobname, schedule FROM cron.job ORDER BY jobname;
