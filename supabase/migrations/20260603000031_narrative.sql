CREATE TABLE IF NOT EXISTS mavis_narrative (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  narrative TEXT NOT NULL DEFAULT '',
  identity_summary TEXT NOT NULL DEFAULT '',
  themes TEXT[] DEFAULT '{}',
  arc TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE mavis_narrative ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON mavis_narrative FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_narrative_user ON mavis_narrative(user_id);
CREATE INDEX idx_narrative_created ON mavis_narrative(user_id, created_at DESC);
