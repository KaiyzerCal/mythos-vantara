-- MAVIS Spaced Repetition + Goal Decomposition Engine

-- ── Spaced repetition columns on mavis_notes ─────────────────
ALTER TABLE mavis_notes
  ADD COLUMN IF NOT EXISTS last_reviewed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS next_review_at        timestamptz,
  ADD COLUMN IF NOT EXISTS review_interval_days  integer DEFAULT 7;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_notes_review
    ON mavis_notes (user_id, next_review_at ASC NULLS FIRST);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ── Goal decomposition table ──────────────────────────────────
CREATE TABLE IF NOT EXISTS mavis_goals (
  id           uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  objective    text         NOT NULL,
  context      text         DEFAULT '',
  status       text         DEFAULT 'active',   -- active | completed | abandoned
  decomposed   boolean      DEFAULT false,
  quest_ids    uuid[]       DEFAULT '{}',
  created_at   timestamptz  DEFAULT now(),
  updated_at   timestamptz  DEFAULT now()
);

ALTER TABLE mavis_goals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "own goals" ON mavis_goals FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_goals_user_status
    ON mavis_goals (user_id, status, created_at DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ── pg_cron schedules (uncomment after setting project ref + service key) ──
--
-- Daily spaced repetition review at 08:00 UTC:
-- SELECT cron.schedule(
--   'mavis-spaced-repetition',
--   '0 8 * * *',
--   $$ SELECT net.http_post(
--     url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/mavis-spaced-repetition',
--     headers := jsonb_build_object('Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'),
--     body    := '{}'::jsonb
--   ); $$
-- );
--
-- Weekly review every Sunday at 22:00 UTC:
-- SELECT cron.schedule(
--   'mavis-weekly-review',
--   '0 22 * * 0',
--   $$ SELECT net.http_post(
--     url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/mavis-periodic-review',
--     headers := jsonb_build_object('Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'),
--     body    := '{"type":"weekly"}'::jsonb
--   ); $$
-- );
--
-- Monthly review on the last day of each month at 23:30 UTC:
-- SELECT cron.schedule(
--   'mavis-monthly-review',
--   '30 23 28-31 * *',
--   $$ SELECT net.http_post(
--     url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/mavis-periodic-review',
--     headers := jsonb_build_object('Content-Type','application/json','Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'),
--     body    := '{"type":"monthly"}'::jsonb
--   ); $$
-- );
