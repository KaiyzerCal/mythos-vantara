-- nora_engagement_log: tracks every mention/DM Nora has seen and replied to.
-- No RLS — service role only (cron-driven, no user context).
CREATE TABLE IF NOT EXISTS nora_engagement_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type              TEXT NOT NULL CHECK (type IN ('mention', 'dm')),
  source_id         TEXT NOT NULL UNIQUE,    -- tweet ID or DM event ID
  source_author_id  TEXT,                   -- Twitter user ID of the sender
  source_text       TEXT,                   -- original tweet/DM text
  reply_text        TEXT,                   -- generated reply
  reply_id          TEXT,                   -- tweet ID or DM event ID of our reply
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('replied', 'failed', 'skipped', 'pending')),
  error             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nora_engagement_type_date
  ON nora_engagement_log(type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nora_engagement_source_id
  ON nora_engagement_log(source_id);

-- Cron: run mavis-nora-engage every 15 minutes
SELECT cron.schedule(
  'mavis-nora-engage',
  '*/15 * * * *',
  $$
    SELECT net.http_post(
      url      := current_setting('app.supabase_url') || '/functions/v1/mavis-nora-engage',
      headers  := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body     := '{}'::jsonb
    );
  $$
);
