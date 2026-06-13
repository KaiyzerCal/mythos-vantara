CREATE TABLE IF NOT EXISTS mavis_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prediction_type TEXT NOT NULL CHECK (prediction_type IN (
    'upcoming_need', 'behavioral_pattern', 'risk_alert',
    'opportunity', 'health_insight', 'productivity_window'
  )),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence NUMERIC(3,2) DEFAULT 0.70 CHECK (confidence BETWEEN 0 AND 1),
  triggers JSONB DEFAULT '[]'::jsonb,
  acted_on BOOLEAN DEFAULT FALSE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE mavis_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON mavis_predictions FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_predictions_user ON mavis_predictions(user_id);
CREATE INDEX idx_predictions_active ON mavis_predictions(user_id, acted_on, expires_at);

CREATE TABLE IF NOT EXISTS mavis_behavioral_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pattern_type TEXT NOT NULL,
  pattern_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  sample_size INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, pattern_type)
);
ALTER TABLE mavis_behavioral_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON mavis_behavioral_patterns FOR ALL USING (auth.uid() = user_id);
