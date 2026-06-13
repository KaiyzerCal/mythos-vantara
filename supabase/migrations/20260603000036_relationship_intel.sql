CREATE TABLE IF NOT EXISTS mavis_relationship_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  contact_name TEXT NOT NULL,
  health_score NUMERIC(3,1) DEFAULT 5.0 CHECK (health_score BETWEEN 0 AND 10),
  last_interaction_at TIMESTAMPTZ,
  days_since_contact INTEGER DEFAULT 0,
  interaction_frequency TEXT DEFAULT 'unknown' CHECK (interaction_frequency IN ('daily','weekly','monthly','quarterly','rare','dormant','unknown')),
  relationship_type TEXT DEFAULT 'professional',
  notes TEXT DEFAULT '',
  suggested_action TEXT DEFAULT '',
  action_urgency TEXT DEFAULT 'low' CHECK (action_urgency IN ('low','medium','high','critical')),
  alert_sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE mavis_relationship_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON mavis_relationship_health FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_rel_health_user ON mavis_relationship_health(user_id);
CREATE INDEX idx_rel_health_dormant ON mavis_relationship_health(user_id, days_since_contact DESC);
