-- Undo-last-delete: lets the operator reverse an accidental deletion of a
-- skill, quest, journal entry, or any other owned "item", from any path
-- (MAVIS chat/the quick tool panel, or a page's own trash-icon button).
--
-- Rule 1 from this repo's CLAUDE.md "Database Changes" section: every DDL
-- statement sets lock_timeout first, so a blocked statement fails fast and
-- releases the queue instead of head-of-line-blocking other traffic.
SET lock_timeout = '3s';
SET statement_timeout = '60s';

-- action_undo_log: one row per deleted record, snapshotting the full row
-- before it's gone. user_id is a plain column, NOT a foreign key to
-- auth.users — this repo's CLAUDE.md flags auth.users as radioactive
-- (a sign-in-blocking outage on 2026-08-22 traced to exactly this kind of
-- FK). Ownership is enforced by the RLS policy below instead.
CREATE TABLE IF NOT EXISTS action_undo_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  table_name  text NOT NULL,
  row_data    jsonb NOT NULL,
  deleted_at  timestamptz NOT NULL DEFAULT now(),
  undone_at   timestamptz
);

CREATE INDEX IF NOT EXISTS action_undo_log_user_active_idx
  ON action_undo_log (user_id, deleted_at DESC)
  WHERE undone_at IS NULL;

ALTER TABLE action_undo_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users manage own undo log" ON action_undo_log
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Generic BEFORE DELETE trigger function. Attached below to every
-- user-owned, deletable "item" table — each has an id and a user_id column,
-- verified against the live schema before writing this migration.
-- SECURITY DEFINER + explicit search_path so it can write to
-- action_undo_log regardless of the caller's own RLS grants on that table.
CREATE OR REPLACE FUNCTION log_delete_for_undo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO action_undo_log (user_id, table_name, row_data)
  VALUES (OLD.user_id, TG_TABLE_NAME, to_jsonb(OLD));
  RETURN OLD;
END;
$$;

-- Attach the trigger to every table covered by this feature. Re-runnable:
-- DROP TRIGGER IF EXISTS before each CREATE, per rule 3 (migrations must be
-- safe to run again with no cleanup).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'skills', 'quests', 'journal_entries', 'vault_entries', 'councils',
    'inventory', 'energy_systems', 'allies', 'transformations',
    'store_items', 'rankings_profiles', 'rituals', 'mavis_domain_effects',
    'mavis_notes', 'mavis_goals', 'calendar_events', 'meeting_notes'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_log_delete_for_undo ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_log_delete_for_undo BEFORE DELETE ON %I
       FOR EACH ROW EXECUTE FUNCTION log_delete_for_undo()',
      t
    );
  END LOOP;
END $$;
