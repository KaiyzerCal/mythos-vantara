-- mavis_ambient_events
-- Stores one row per cron run per user, recording what the ambient monitor checked,
-- found, and acted upon. Used for audit trails and dashboards.

CREATE TABLE IF NOT EXISTS mavis_ambient_events (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  checks_run   integer     DEFAULT 0,
  issues_found integer     DEFAULT 0,
  actions_taken integer    DEFAULT 0,
  details      jsonb       DEFAULT '{}',
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE mavis_ambient_events ENABLE ROW LEVEL SECURITY;

-- Users can read their own ambient event history (read-only; writes are service-role only)
DO $$ BEGIN
  CREATE POLICY "Users read own ambient events"
    ON mavis_ambient_events
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Index for dashboard queries sorted by time
DO $$ BEGIN
  CREATE INDEX idx_ambient_events_user_time
    ON mavis_ambient_events (user_id, created_at DESC);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Index for aggregate stats (issues count filtering)
DO $$ BEGIN
  CREATE INDEX idx_ambient_events_issues
    ON mavis_ambient_events (user_id, issues_found)
    WHERE issues_found > 0;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
