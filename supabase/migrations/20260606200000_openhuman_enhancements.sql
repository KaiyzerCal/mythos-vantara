-- ============================================================
-- VANTARA.EXE — OpenHuman Enhancement Pack
-- Real-time facet capture, staged notifications, archivist cron
-- ============================================================

-- 1. Real-time preference facets on user behavioral model
--    (Style, Identity, Tooling, Veto, Goal, Channel classes)
ALTER TABLE public.mavis_user_model
  ADD COLUMN IF NOT EXISTS facets JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.mavis_user_model.facets IS
  'Real-time preference facets captured per-turn. Keys: style, identity, tooling, veto, goal, channel.';

-- 2. Staged notification deduplication table
--    (OpenHuman Heartbeat pattern — cross-tick SHA-256 dedupe)
CREATE TABLE IF NOT EXISTS notification_stages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dedupe_key  text        NOT NULL,
  stage       text        NOT NULL CHECK (stage IN ('heads_up', 'final_call', 'due_now', 'general')),
  event_ref   text,
  sent_at     timestamptz DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  UNIQUE(user_id, dedupe_key, stage)
);

ALTER TABLE notification_stages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own stages" ON notification_stages
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_notification_stages_user_expires
  ON notification_stages(user_id, expires_at);

-- 3. Register mavis-archivist cron (weekly Sunday 4am UTC)
--    Prunes and deduplicates mavis_memory (conversation log)
INSERT INTO mavis_cron_config (job_name, function_name, schedule, payload)
VALUES ('mavis-archivist', 'mavis-archivist', '0 4 * * 0', '{"scheduled":true}')
ON CONFLICT (job_name) DO NOTHING;
