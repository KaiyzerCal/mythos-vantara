-- Migration 5: cross_persona_awareness table
CREATE TABLE cross_persona_awareness (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  persona_id UUID REFERENCES personas(id) ON DELETE CASCADE,
  aware_of_persona_id UUID REFERENCES personas(id) ON DELETE CASCADE,
  relationship_to_other TEXT,
  awareness_notes TEXT,
  UNIQUE(persona_id, aware_of_persona_id)
);
