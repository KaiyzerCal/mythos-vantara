-- =============================================================================
-- 20260517250000_integrations.sql
-- Integration tables: outbound webhook infrastructure, social analytics,
-- and email outbox.
-- =============================================================================

-- Outbound webhook configuration
CREATE TABLE IF NOT EXISTS webhook_dispatch_config (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  event_types  TEXT[] NOT NULL DEFAULT '{*}',
  secret       TEXT,
  active       BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE webhook_dispatch_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users own webhook_dispatch_config"
  ON webhook_dispatch_config FOR ALL USING (auth.uid() = user_id);

-- Outbound webhook dispatch log
CREATE TABLE IF NOT EXISTS webhook_dispatch_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id   UUID REFERENCES webhook_dispatch_config(id) ON DELETE SET NULL,
  user_id     UUID,
  event_type  TEXT,
  payload     JSONB,
  status_code INT,
  ok          BOOLEAN DEFAULT false,
  error       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_dispatch_log_user
  ON webhook_dispatch_log(user_id, created_at DESC);

-- Social post analytics (stores fetched engagement metrics)
CREATE TABLE IF NOT EXISTS social_post_analytics (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id          UUID REFERENCES mavis_social_posts(id) ON DELETE SET NULL,
  platform         TEXT NOT NULL,
  external_post_id TEXT,
  impressions      INT DEFAULT 0,
  likes            INT DEFAULT 0,
  replies_count    INT DEFAULT 0,
  reposts          INT DEFAULT 0,
  profile_clicks   INT DEFAULT 0,
  fetched_at       TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE social_post_analytics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users own social_post_analytics"
  ON social_post_analytics FOR ALL USING (auth.uid() = user_id);

-- Email outbox
CREATE TABLE IF NOT EXISTS email_outbox (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_address  TEXT NOT NULL,
  subject     TEXT,
  body        TEXT,
  resend_id   TEXT,
  status      TEXT DEFAULT 'sent',
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users own email_outbox"
  ON email_outbox FOR ALL USING (auth.uid() = user_id);

-- Add external_post_id to mavis_social_posts for analytics linking
ALTER TABLE mavis_social_posts ADD COLUMN IF NOT EXISTS external_post_id TEXT;
