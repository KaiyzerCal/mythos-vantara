-- Add email, phone, company, source columns to contacts table.
-- mavis-gcontacts-sync has been attempting to write these columns since it was
-- created, but they never existed in the schema, so all synced contacts were
-- silently dropped. This migration also adds the unique index required by the
-- upsert's onConflict: "user_id,email" clause.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS email   TEXT,
  ADD COLUMN IF NOT EXISTS phone   TEXT,
  ADD COLUMN IF NOT EXISTS company TEXT,
  ADD COLUMN IF NOT EXISTS source  TEXT DEFAULT 'manual';

-- Unique index so gcontacts-sync upsert works correctly.
-- Partial index (WHERE email IS NOT NULL) so contacts without emails
-- don't conflict with each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_user_email
  ON contacts(user_id, email)
  WHERE email IS NOT NULL;
