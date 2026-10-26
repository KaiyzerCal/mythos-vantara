-- skills.parent_skill_id was a plain uuid column with no FK constraint —
-- pure convention, never validated at write time. Found via an audit:
-- deleting a skill that others reference as parent left orphaned
-- references with nothing to catch it (buildSystemPrompt.ts's name lookup
-- degrades gracefully on a miss rather than crashing, which is exactly why
-- this went unnoticed). Verified zero existing orphans live before adding
-- this, so the constraint can go on cleanly.
--
-- ON DELETE SET NULL, not CASCADE: deleting a pathway/parent skill should
-- orphan its children into plain root-level skills, not silently delete an
-- entire subtree (that's a much more destructive default than anything the
-- app currently does, and action_undo_log only captures the row actually
-- deleted, not a cascade).
--
-- Rule 1 from this repo's CLAUDE.md "Database Changes" section: every DDL
-- statement sets lock_timeout first.
SET lock_timeout = '3s';
SET statement_timeout = '60s';

-- FK-referenced columns should be indexed; this one wasn't, despite being
-- the join key for every getSubskills(parentId) call in the app.
CREATE INDEX IF NOT EXISTS skills_parent_skill_id_idx ON skills (parent_skill_id);

-- Re-runnable: ADD CONSTRAINT has no IF NOT EXISTS, so catch duplicate_object
-- the same way this repo's other migrations do.
DO $$ BEGIN
  ALTER TABLE skills
    ADD CONSTRAINT skills_parent_skill_id_fkey
    FOREIGN KEY (parent_skill_id) REFERENCES skills(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
