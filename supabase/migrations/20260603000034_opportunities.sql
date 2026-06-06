CREATE TABLE IF NOT EXISTS mavis_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  opportunity_type TEXT NOT NULL CHECK (opportunity_type IN (
    'skill_gap_bridge', 'timing_window', 'dormant_asset',
    'cross_domain_synergy', 'pattern_leverage', 'relationship_leverage',
    'financial_optimization', 'health_performance'
  )),
  domains TEXT[] DEFAULT '{}',
  potential_value TEXT DEFAULT '',
  action_steps JSONB DEFAULT '[]'::jsonb,
  confidence NUMERIC(3,2) DEFAULT 0.70,
  expires_at TIMESTAMPTZ,
  acted_on BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE mavis_opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON mavis_opportunities FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_opportunities_user ON mavis_opportunities(user_id);
CREATE INDEX idx_opportunities_active ON mavis_opportunities(user_id, acted_on, expires_at);
