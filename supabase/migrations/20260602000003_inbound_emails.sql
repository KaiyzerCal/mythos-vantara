-- MAVIS Inbound Email Inbox
-- Stores emails received via Resend inbound webhook (mavis-email-inbound function).

CREATE TABLE IF NOT EXISTS mavis_inbound_emails (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  from_email   TEXT NOT NULL,
  from_name    TEXT,
  to_email     TEXT,
  subject      TEXT NOT NULL DEFAULT '(no subject)',
  body_text    TEXT,
  body_html    TEXT,
  thread_id    TEXT,
  attachments  JSONB NOT NULL DEFAULT '[]',
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed    BOOLEAN NOT NULL DEFAULT FALSE,
  replied_at   TIMESTAMPTZ,
  labels       TEXT[] DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS mavis_inbound_emails_user_idx     ON mavis_inbound_emails(user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS mavis_inbound_emails_from_idx     ON mavis_inbound_emails(from_email);
CREATE INDEX IF NOT EXISTS mavis_inbound_emails_thread_idx   ON mavis_inbound_emails(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mavis_inbound_emails_unread_idx   ON mavis_inbound_emails(user_id) WHERE processed = FALSE;

ALTER TABLE mavis_inbound_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own emails"
  ON mavis_inbound_emails FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "service role manages all"
  ON mavis_inbound_emails FOR ALL
  USING (auth.role() = 'service_role');

-- Add function to disable jwt_verification for mavis-email-inbound in config.toml
-- (Resend cannot send a Supabase JWT — must be in jwt_disabled list)
COMMENT ON TABLE mavis_inbound_emails IS
  'Inbound emails received via Resend webhook. Add mavis-email-inbound to supabase/config.toml jwt_disabled list.';
