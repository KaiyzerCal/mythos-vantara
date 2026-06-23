-- ── New capabilities: Polymarket, Maps, arXiv, RSS Monitor ────────────────

-- 1. source_url on mavis_notes (used by arxiv save_to_vault + rss ingestion)
ALTER TABLE mavis_notes ADD COLUMN IF NOT EXISTS source_url TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS mavis_notes_user_source_url_idx
  ON mavis_notes (user_id, source_url)
  WHERE source_url IS NOT NULL;

-- 2. mavis_rss_feeds — user-defined RSS/Atom feed subscriptions
CREATE TABLE IF NOT EXISTS mavis_rss_feeds (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL DEFAULT '',
  feed_url        TEXT        NOT NULL,
  enabled         BOOLEAN     NOT NULL DEFAULT TRUE,
  last_fetched_at TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, feed_url)
);

ALTER TABLE mavis_rss_feeds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own rss feeds"
  ON mavis_rss_feeds FOR ALL TO authenticated
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Index for heartbeat fetch_all (polls all enabled feeds)
CREATE INDEX IF NOT EXISTS mavis_rss_feeds_enabled_idx ON mavis_rss_feeds (enabled) WHERE enabled = TRUE;
