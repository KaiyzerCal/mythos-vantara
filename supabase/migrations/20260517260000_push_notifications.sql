-- device push tokens for mobile/web push notifications
CREATE TABLE IF NOT EXISTS device_push_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token        TEXT NOT NULL,
  platform     TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  device_name  TEXT,
  active       BOOLEAN NOT NULL DEFAULT true,
  error_count  INT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, token)
);

ALTER TABLE device_push_tokens ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own tokens" ON device_push_tokens
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_device_push_tokens_user
    ON device_push_tokens(user_id) WHERE active = true;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Cron: mid-day nudge at noon UTC daily
SELECT cron.schedule(
  'mavis-proactive-nudge',
  '0 12 * * *',
  $$
    SELECT net.http_post(
      url     := current_setting('app.supabase_url') || '/functions/v1/mavis-proactive-nudge',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body    := '{}'::jsonb
    );
  $$
);
