-- Applied to the live database 2026-11-16 (via Lovable query_database). Re-runnable; kept here so the repo matches.
-- 1. mavis_persona_memory.key defaulted to '' and is UNIQUE(user_id,key), so only ONE row could ever exist per user:
--    every persona-chat mirror insert failed silently from 2026-07-10 on. NULL keys are distinct, so default to NULL.
SET lock_timeout = '3s';
SET statement_timeout = '60s';
ALTER TABLE public.mavis_persona_memory ALTER COLUMN key DROP DEFAULT;
UPDATE public.mavis_persona_memory SET key = NULL WHERE key = '';

-- 2. The analysis engines were not on the schedule (the June cron reset used current_setting('app.supabase_url'), which
--    is unset here). Same vault lookup the working jobs use. mavis_data_retention(), the market-radar / outcome-tracker /
--    self-evolve / data-retention reschedules are in 20261113010000_fix_failing_crons.sql (self-evolve also moved to the
--    decrypted_secrets lookup).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('mavis-predictive-engine','0 6 * * *','mavis-predictive-engine'),
    ('mavis-performance-science-daily','5 7 * * *','mavis-performance-science'),
    ('mavis-opportunity-scanner','0 7 * * *','mavis-opportunity-scanner'),
    ('mavis-profile-updater-daily','30 3 * * *','mavis-profile-updater'),
    ('mavis-periodic-review','0 3 * * 0','mavis-periodic-review'),
    ('mavis-narrative-engine','0 4 * * 0','mavis-narrative-engine'),
    ('mavis-world-model','0 5 * * 0','mavis-world-model'),
    ('mavis-relationship-intel','0 8 * * 1','mavis-relationship-intel'),
    ('mavis-pattern-insights','0 4 * * 1','mavis-pattern-insights')
  ) AS v(n,s,f) LOOP
    PERFORM cron.schedule(r.n, r.s, format($c$ SELECT net.http_post(url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/%s', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')), body := '{"cron":true,"trigger":"cron"}'::jsonb, timeout_milliseconds := 120000); $c$, r.f));
  END LOOP;
END $$;

-- 3. mavis_insights had no `source` column, but five writers set it (nudges, morning brief, autonomous runner, pattern
--    insights, design system), so every insert failed. Additive and nullable.
ALTER TABLE public.mavis_insights ADD COLUMN IF NOT EXISTS source text;

-- 4. Columns that writers already send but the tables lacked (all four tables were empty; additive, nullable).
ALTER TABLE public.video_projects ADD COLUMN IF NOT EXISTS content_type text, ADD COLUMN IF NOT EXISTS full_clip_recommendation text;
ALTER TABLE public.mavis_social_queue ADD COLUMN IF NOT EXISTS heygen_avatar_id text, ADD COLUMN IF NOT EXISTS heygen_voice_id text,
  ADD COLUMN IF NOT EXISTS youtube_status text, ADD COLUMN IF NOT EXISTS youtube_url text, ADD COLUMN IF NOT EXISTS youtube_video_id text;

-- 5. mavis_memory.session_id / timestamp are NOT NULL with no default, so every agent that logs a one-line memory
--    (google, security, story, comic, ...) failed. Defaults are metadata-only. Also two self-improve columns.
ALTER TABLE public.mavis_memory ALTER COLUMN session_id SET DEFAULT 'system';
ALTER TABLE public.mavis_memory ALTER COLUMN "timestamp" SET DEFAULT (extract(epoch from now()) * 1000)::bigint;
ALTER TABLE public.mavis_improvement_log ADD COLUMN IF NOT EXISTS openai_job_id text, ADD COLUMN IF NOT EXISTS trained_model_name text;
