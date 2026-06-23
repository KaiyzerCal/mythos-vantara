CREATE TABLE IF NOT EXISTS mavis_world_model (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  trajectory TEXT NOT NULL DEFAULT '',
  key_insights JSONB DEFAULT '[]'::jsonb,
  domains JSONB DEFAULT '{}'::jsonb,
  opportunities JSONB DEFAULT '[]'::jsonb,
  risks JSONB DEFAULT '[]'::jsonb,
  data_sources JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE mavis_world_model ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON mavis_world_model FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_world_model_user ON mavis_world_model(user_id);
CREATE INDEX idx_world_model_created ON mavis_world_model(user_id, created_at DESC);
