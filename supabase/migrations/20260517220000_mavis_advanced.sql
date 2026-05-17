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

-- Add extraction tracking to vault_media
ALTER TABLE public.vault_media ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ;
ALTER TABLE public.vault_media ADD COLUMN IF NOT EXISTS extraction_error TEXT;
