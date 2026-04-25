-- Migration 3: relationship_states table
CREATE TABLE relationship_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID REFERENCES personas(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  trust_level INTEGER DEFAULT 50 CHECK (trust_level BETWEEN 0 AND 100),
  bond_level INTEGER DEFAULT 0 CHECK (bond_level BETWEEN 0 AND 100),
  current_mood TEXT DEFAULT 'neutral',
  mood_reason TEXT,
  last_interaction_at TIMESTAMPTZ,
  total_interactions INTEGER DEFAULT 0,
  relationship_milestones JSONB DEFAULT '[]',
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(persona_id, user_id)
);

ALTER TABLE relationship_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their relationship states" ON relationship_states
  FOR ALL USING (auth.uid() = user_id);
