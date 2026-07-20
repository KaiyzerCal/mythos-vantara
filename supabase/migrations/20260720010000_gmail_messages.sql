-- ─────────────────────────────────────────────────────────────────────────────
-- gmail_messages
--
-- Structured store of synced Gmail messages. mavis-email-triage and
-- mavis-ambient-monitor (priority-email detection) both read this table but
-- nothing populated it, so those features were permanent no-ops. mavis-gmail-sync
-- now upserts into it.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.gmail_messages (
  id           text        PRIMARY KEY,               -- Gmail message id
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id    text,
  subject      text        NOT NULL DEFAULT '',
  from_email   text        NOT NULL DEFAULT '',
  from_name    text,
  snippet      text,
  body         text,
  labels       text[]      NOT NULL DEFAULT '{}',
  is_read      boolean     NOT NULL DEFAULT true,
  received_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gmail_messages_user_received
  ON public.gmail_messages (user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_gmail_messages_user_unread
  ON public.gmail_messages (user_id, is_read, received_at DESC);

ALTER TABLE public.gmail_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "own gmail messages" ON public.gmail_messages
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
