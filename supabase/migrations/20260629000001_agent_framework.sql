-- Agent Framework: timezone awareness + 7-folder structure per entity

-- Operator timezone (read from browser/profile settings)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

-- Per-persona timezone (for personas who "live" in a different timezone or era)
ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS timezone TEXT;

-- Per-council-member timezone
ALTER TABLE councils
  ADD COLUMN IF NOT EXISTS timezone TEXT;

-- 7-Folder agent framework data per persona
-- Stores freeform markdown for each of the 7 folders
-- identity / user_context / operations / memory_notes / references / output / evals
ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS agent_folders JSONB NOT NULL DEFAULT '{}';

-- 7-Folder agent framework data per council member
ALTER TABLE councils
  ADD COLUMN IF NOT EXISTS agent_folders JSONB NOT NULL DEFAULT '{}';

-- Index for fast JSON key access
CREATE INDEX IF NOT EXISTS idx_personas_agent_folders ON personas USING gin(agent_folders);
CREATE INDEX IF NOT EXISTS idx_councils_agent_folders ON councils USING gin(agent_folders);
