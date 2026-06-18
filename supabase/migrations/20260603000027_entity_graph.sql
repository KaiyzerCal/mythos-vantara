CREATE TABLE IF NOT EXISTS mavis_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'company', 'project', 'place', 'concept', 'product', 'event')),
  description TEXT DEFAULT '',
  aliases TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}'::jsonb,
  mention_count INTEGER DEFAULT 1,
  last_mentioned TIMESTAMPTZ DEFAULT NOW(),
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name, entity_type)
);
ALTER TABLE mavis_entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON mavis_entities FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_entities_user ON mavis_entities(user_id);
CREATE INDEX idx_entities_type ON mavis_entities(user_id, entity_type);

CREATE TABLE IF NOT EXISTS mavis_entity_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_a_id UUID NOT NULL REFERENCES mavis_entities(id) ON DELETE CASCADE,
  entity_b_id UUID NOT NULL REFERENCES mavis_entities(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL,
  strength NUMERIC(3,2) DEFAULT 0.5 CHECK (strength BETWEEN 0 AND 1),
  context TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, entity_a_id, entity_b_id, relationship)
);
ALTER TABLE mavis_entity_relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON mavis_entity_relationships FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_entity_rels_user ON mavis_entity_relationships(user_id);
CREATE INDEX idx_entity_rels_a ON mavis_entity_relationships(entity_a_id);
CREATE INDEX idx_entity_rels_b ON mavis_entity_relationships(entity_b_id);

CREATE TABLE IF NOT EXISTS mavis_entity_graph_cursor (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_processed_at TIMESTAMPTZ DEFAULT '1970-01-01'::timestamptz
);
ALTER TABLE mavis_entity_graph_cursor ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON mavis_entity_graph_cursor FOR ALL USING (auth.uid() = user_id);
