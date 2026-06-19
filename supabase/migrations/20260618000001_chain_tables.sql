-- Quest chains: ordered progressions of related quests
CREATE TABLE IF NOT EXISTS quest_chains (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text DEFAULT '',
  category    text DEFAULT '',
  status      text DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quest_chain_items (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id  uuid NOT NULL REFERENCES quest_chains(id) ON DELETE CASCADE,
  quest_id  uuid NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  position  integer NOT NULL DEFAULT 0,
  UNIQUE (chain_id, quest_id)
);

ALTER TABLE quest_chains ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quest_chains_user" ON quest_chains FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
ALTER TABLE quest_chain_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quest_chain_items_user" ON quest_chain_items FOR ALL
  USING (EXISTS (SELECT 1 FROM quest_chains WHERE id = chain_id AND user_id = auth.uid()));

-- Skill chains: ordered progressions of related skills
CREATE TABLE IF NOT EXISTS skill_chains (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text DEFAULT '',
  category    text DEFAULT '',
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skill_chain_items (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id  uuid NOT NULL REFERENCES skill_chains(id) ON DELETE CASCADE,
  skill_id  uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  position  integer NOT NULL DEFAULT 0,
  UNIQUE (chain_id, skill_id)
);

ALTER TABLE skill_chains ENABLE ROW LEVEL SECURITY;
CREATE POLICY "skill_chains_user" ON skill_chains FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "skill_chain_items_user" ON skill_chain_items FOR ALL
  USING (EXISTS (SELECT 1 FROM skill_chains WHERE id = chain_id AND user_id = auth.uid()));
ALTER TABLE skill_chain_items ENABLE ROW LEVEL SECURITY;
