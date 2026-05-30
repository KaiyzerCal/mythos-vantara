-- Add parent_quest_id to enable sub-quests (quests nested under parent quests).
-- Sub-quests appear in the Quests tab under their parent quest.
-- MAVIS uses create_quest with parent_quest_id instead of create_task.
ALTER TABLE quests
  ADD COLUMN IF NOT EXISTS parent_quest_id uuid REFERENCES quests(id) ON DELETE CASCADE;

-- Index for efficient sub-quest lookup
CREATE INDEX IF NOT EXISTS idx_quests_parent_quest_id ON quests(parent_quest_id)
  WHERE parent_quest_id IS NOT NULL;

-- View: quests with sub-quest count (useful for UI badges)
CREATE OR REPLACE VIEW quest_with_sub_count AS
SELECT
  q.*,
  COUNT(sub.id) FILTER (WHERE sub.status = 'active')   AS active_sub_quest_count,
  COUNT(sub.id) FILTER (WHERE sub.status = 'completed') AS completed_sub_quest_count,
  COUNT(sub.id) AS total_sub_quest_count
FROM quests q
LEFT JOIN quests sub ON sub.parent_quest_id = q.id
WHERE q.parent_quest_id IS NULL  -- only top-level quests
GROUP BY q.id;
