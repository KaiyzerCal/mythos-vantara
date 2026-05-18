-- Allow multiple Telegram accounts to talk to the same MAVIS operator.
-- Each row maps a secondary Telegram user ID to the operator's Supabase user.
-- The telegram-webhook edge function queries this table when the incoming
-- sender does not match the primary TELEGRAM_OPERATOR_CHAT_ID env var.

CREATE TABLE IF NOT EXISTS public.telegram_linked_accounts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_user_id text        NOT NULL,
  label            text        NOT NULL DEFAULT 'Linked Account',
  created_at       timestamptz DEFAULT now(),
  UNIQUE (user_id, telegram_user_id)
);

ALTER TABLE public.telegram_linked_accounts ENABLE ROW LEVEL SECURITY;

-- Users can only manage their own linked accounts
CREATE POLICY "Users manage own linked telegram accounts"
  ON public.telegram_linked_accounts
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for fast lookup by telegram_user_id (used by edge function)
CREATE INDEX IF NOT EXISTS idx_telegram_linked_accounts_tg_user
  ON public.telegram_linked_accounts(telegram_user_id);
