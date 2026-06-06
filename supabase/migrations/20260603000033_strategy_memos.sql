CREATE TABLE IF NOT EXISTS mavis_strategy_memos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  synthesis TEXT NOT NULL,
  advisor_outputs JSONB DEFAULT '[]'::jsonb,
  recommendation TEXT NOT NULL,
  confidence NUMERIC(3,2) DEFAULT 0.80,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE mavis_strategy_memos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON mavis_strategy_memos FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_strategy_memos_user ON mavis_strategy_memos(user_id);
