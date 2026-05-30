-- MAVIS Advanced Features Migration
-- webhook_events table + vault_media extraction tracking

-- Webhook events log
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL,
  source TEXT DEFAULT 'unknown',
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  data JSONB DEFAULT '{}',
  actions_executed JSONB DEFAULT '[]',
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Service role only, no RLS needed (internal table)
CREATE INDEX idx_webhook_events_user ON public.webhook_events(user_id, created_at DESC);
CREATE INDEX idx_webhook_events_type ON public.webhook_events(event_type, created_at DESC);

-- vault_media (created via dashboard — ensure it exists before altering)
CREATE TABLE IF NOT EXISTS public.vault_media (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vault_entry_id  uuid        REFERENCES public.vault_entries(id) ON DELETE SET NULL,
  file_name       text        NOT NULL,
  file_url        text        NOT NULL,
  file_type       text        NOT NULL DEFAULT '',
  file_size       int         NOT NULL DEFAULT 0,
  description     text        NOT NULL DEFAULT '',
  tags            text[]      NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vault_media ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own vault media" ON public.vault_media FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_vault_media_user ON public.vault_media(user_id, created_at DESC);

-- Add extraction tracking to vault_media
ALTER TABLE public.vault_media ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ;
ALTER TABLE public.vault_media ADD COLUMN IF NOT EXISTS extraction_error TEXT;
