-- mavis_email_watches
-- Stores requests from the operator to be notified when a specific contact
-- sends a reply. Created by the watch_email_reply tool inside mavis-agent.
-- Checked every 10 minutes by mavis-trigger-engine.
CREATE TABLE IF NOT EXISTS mavis_email_watches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  contact_email   TEXT NOT NULL,      -- email address to watch for (lowercase)
  contact_name    TEXT,               -- display name for notification
  context         TEXT,               -- why we're watching (e.g. "sent Primal Agent pitch")
  active          BOOLEAN DEFAULT true,
  triggered_at    TIMESTAMPTZ,        -- set when the reply is detected
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_watches_user_active
  ON mavis_email_watches(user_id, active, created_at DESC);

-- Auto-expire watches after 30 days (cleanup only, not a hard delete)
-- Handled by the trigger-engine deactivating triggered watches.
