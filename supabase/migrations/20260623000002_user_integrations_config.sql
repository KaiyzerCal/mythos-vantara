-- Ensure mavis_user_integrations exists with all required columns.
-- The original migration (20260517280000) created it with only key_value TEXT,
-- but the OAuth and executor functions also need config JSONB and status TEXT.

CREATE TABLE IF NOT EXISTS public.mavis_user_integrations (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider    text         NOT NULL,
  key_name    text         NOT NULL,
  key_value   text         NOT NULL DEFAULT '',
  config      jsonb,
  status      text,
  verified    boolean      NOT NULL DEFAULT false,
  last_tested timestamptz,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, key_name)
);

-- Add columns if the table already existed without them
ALTER TABLE public.mavis_user_integrations
  ADD COLUMN IF NOT EXISTS config   jsonb,
  ADD COLUMN IF NOT EXISTS status   text;

-- Make key_value optional so upserts without a plain-text value still work
ALTER TABLE public.mavis_user_integrations
  ALTER COLUMN key_value SET DEFAULT '';

ALTER TABLE public.mavis_user_integrations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users manage own integrations" ON public.mavis_user_integrations
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Service-role bypass (needed by Edge Functions)
DO $$ BEGIN
  CREATE POLICY "Service role bypass" ON public.mavis_user_integrations
    AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_mavis_user_integrations_user_provider
  ON public.mavis_user_integrations(user_id, provider);
