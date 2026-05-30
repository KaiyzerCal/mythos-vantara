-- MAVIS Enhancements: expense tracking + operator bond

-- ── Expense ledger ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mavis_expenses (
  id          uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  description text         NOT NULL,
  amount      numeric(12,2) NOT NULL,
  currency    text         DEFAULT 'USD',
  category    text         DEFAULT 'general',
  source      text         DEFAULT '',
  expense_date date        DEFAULT CURRENT_DATE,
  created_at  timestamptz  DEFAULT now()
);

ALTER TABLE mavis_expenses ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "own expenses" ON mavis_expenses FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON mavis_expenses (user_id, expense_date DESC);

-- ── MAVIS operator bond ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS mavis_bond (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  interaction_count   integer     DEFAULT 0,
  trust_level         integer     DEFAULT 0,
  bond_level          integer     DEFAULT 0,
  last_interaction_at timestamptz DEFAULT now(),
  milestones          jsonb       DEFAULT '[]'::jsonb,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

ALTER TABLE mavis_bond ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "own bond" ON mavis_bond FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── pg_cron schedules (uncomment with real project ref + service role key) ──
--
-- Morning brief at 06:00 UTC daily:
-- SELECT cron.schedule('mavis-morning-brief', '0 6 * * *',
--   $$ SELECT net.http_post(
--     url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/mavis-morning-brief',
--     headers := jsonb_build_object('Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'),
--     body    := '{}'::jsonb
--   ); $$
-- );
--
-- Streak break alerts at 20:00 UTC daily:
-- SELECT cron.schedule('mavis-streak-alerts', '0 20 * * *',
--   $$ SELECT net.http_post(
--     url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/mavis-streak-alerts',
--     headers := jsonb_build_object('Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'),
--     body    := '{}'::jsonb
--   ); $$
-- );
--
-- Goal re-evaluation every Monday at 09:00 UTC:
-- SELECT cron.schedule('mavis-goal-review', '0 9 * * 1',
--   $$ SELECT net.http_post(
--     url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/mavis-goal-review',
--     headers := jsonb_build_object('Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'),
--     body    := '{}'::jsonb
--   ); $$
-- );
--
-- Karma decay every Sunday at 23:00 UTC:
-- SELECT cron.schedule('mavis-karma-decay', '0 23 * * 0',
--   $$ SELECT net.http_post(
--     url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/mavis-council-heartbeat',
--     headers := jsonb_build_object('Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'),
--     body    := '{"karma_decay":true}'::jsonb
--   ); $$
-- );
