-- Track which Notion pages have been synced into MAVIS memory
-- One row per (user, page) — upserted on each sync run
CREATE TABLE IF NOT EXISTS mavis_notion_sync_log (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid        REFERENCES auth.users NOT NULL,
  notion_page_id  text        NOT NULL,
  page_title      text,
  page_url        text,
  last_edited     text,       -- Notion last_edited_time ISO string; used to detect changes
  synced_at       timestamptz DEFAULT now(),
  memory_id       uuid        REFERENCES mavis_agent_memories(id) ON DELETE SET NULL,
  UNIQUE (user_id, notion_page_id)
);

ALTER TABLE mavis_notion_sync_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users manage own notion sync log"
    ON mavis_notion_sync_log FOR ALL
    USING  (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
