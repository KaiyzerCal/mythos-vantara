-- Stores user-provided API keys and integration configs
-- Keys are stored as-is (server-side RLS protects them; advise users to use scoped keys)
CREATE TABLE IF NOT EXISTS mavis_user_integrations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,   -- 'openai', 'anthropic', 'twitter', 'linkedin', 'discord', 'instagram', 'tiktok', 'resend', 'telegram', 'oura', 'stripe', 'gumroad', 'fcm'
  key_name     TEXT NOT NULL,   -- human label e.g. 'API Key', 'Access Token'
  key_value    TEXT NOT NULL,
  verified     BOOLEAN NOT NULL DEFAULT false,
  last_tested  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, provider, key_name)
);

ALTER TABLE mavis_user_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own integrations" ON mavis_user_integrations
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_mavis_user_integrations_user
  ON mavis_user_integrations(user_id, provider);
