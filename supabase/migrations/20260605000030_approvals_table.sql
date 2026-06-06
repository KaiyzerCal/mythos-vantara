-- Approvals table — queued proposed actions from personas, agents, and councils.
-- Used by the Inbox to surface pending writes for operator review.
-- Note: persona CRUD now also executes directly (via mavis-persona-router → mavis-actions),
--       but this table is retained for the Inbox approval UI and for actions that require
--       explicit operator sign-off (delete, financial, etc.).

CREATE TABLE IF NOT EXISTS public.approvals (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type   text        NOT NULL,
  action_summary text       NOT NULL DEFAULT '',
  action_payload jsonb      DEFAULT '{}'::jsonb,
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'rejected', 'executing')),
  proposed_by   text        DEFAULT NULL,
  resolved_at   timestamptz DEFAULT NULL,
  created_at    timestamptz DEFAULT now() NOT NULL,
  updated_at    timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users manage own approvals"
  ON public.approvals FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS approvals_user_status_idx ON public.approvals (user_id, status, created_at DESC);
