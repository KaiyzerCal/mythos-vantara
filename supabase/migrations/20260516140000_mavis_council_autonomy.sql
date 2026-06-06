-- MAVIS Council Autonomy — ElizaOS evaluator + Moltbook heartbeat model
-- Council members wake up every N hours, evaluate Calvin's state,
-- take actions within their specialty, earn karma for useful contributions.

-- ── Autonomy columns on councils ────────────────────────────────
ALTER TABLE councils
  ADD COLUMN IF NOT EXISTS karma                  integer      DEFAULT 0,
  ADD COLUMN IF NOT EXISTS heartbeat_enabled      boolean      DEFAULT true,
  ADD COLUMN IF NOT EXISTS heartbeat_interval_hrs integer      DEFAULT 4,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at      timestamptz,
  ADD COLUMN IF NOT EXISTS character_notes        text;        -- extra personality / focus directives

-- ── Council activity log ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mavis_council_activity (
  id                  uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  council_member_id   uuid         REFERENCES councils(id) ON DELETE SET NULL,
  member_name         text,
  summary             text,
  actions_taken       jsonb        DEFAULT '[]',
  actions_executed    integer      DEFAULT 0,
  karma_delta         integer      DEFAULT 0,
  created_at          timestamptz  DEFAULT now()
);

ALTER TABLE mavis_council_activity ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "own council activity" ON mavis_council_activity FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Index for recent activity lookups
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_council_activity_member
    ON mavis_council_activity (council_member_id, created_at DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ── pg_cron: heartbeat every 4 hours ────────────────────────────
-- Requires pg_cron + pg_net extensions (both available on Supabase hosted).
-- Run this block AFTER setting your project URL and service role key,
-- OR set up the schedule via Supabase Dashboard → Database → Cron Jobs.
--
-- SELECT cron.schedule(
--   'mavis-council-heartbeat',
--   '0 2,6,10,14,18,22 * * *',
--   $$
--     SELECT net.http_post(
--       url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/mavis-council-heartbeat',
--       headers := jsonb_build_object(
--         'Content-Type',  'application/json',
--         'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
--       ),
--       body    := '{}'::jsonb
--     );
--   $$
-- );
