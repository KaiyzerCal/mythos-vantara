-- MAVIS API keys — hashed keys for programmatic access
CREATE TABLE IF NOT EXISTS mavis_api_keys (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,  -- first 12 chars of key for display
  permissions jsonb DEFAULT '["chat","memory"]',
  is_active boolean DEFAULT true,
  last_used_at timestamptz,
  requests_count bigint DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE mavis_api_keys ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "user own api keys" ON mavis_api_keys FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_mavis_api_keys_user ON mavis_api_keys(user_id, created_at DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_mavis_api_keys_hash ON mavis_api_keys(key_hash) WHERE is_active = true;
EXCEPTION WHEN undefined_table THEN NULL; END $$;
