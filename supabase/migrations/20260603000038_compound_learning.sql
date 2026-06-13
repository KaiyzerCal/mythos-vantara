CREATE TABLE IF NOT EXISTS mavis_learning_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('positive', 'negative', 'correction', 'preference')),
  context TEXT NOT NULL,
  response_excerpt TEXT DEFAULT '',
  mode TEXT DEFAULT '',
  tool_used TEXT DEFAULT '',
  learned_preference TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE mavis_learning_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON mavis_learning_signals FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_learning_signals_user ON mavis_learning_signals(user_id);
CREATE INDEX idx_learning_signals_type ON mavis_learning_signals(user_id, signal_type);

CREATE TABLE IF NOT EXISTS mavis_learned_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  preference_key TEXT NOT NULL,
  preference_value TEXT NOT NULL,
  confidence NUMERIC(3,2) DEFAULT 0.70,
  evidence_count INTEGER DEFAULT 1,
  last_reinforced TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, preference_key)
);
ALTER TABLE mavis_learned_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON mavis_learned_preferences FOR ALL USING (auth.uid() = user_id);
