-- Shared AI-provider cool-downs. A provider that is out of credit or at its daily cap is
-- recorded here so every edge function isolate skips it at once, instead of each cold
-- start re-trying it and waiting for failures. Written/read only by edge functions
-- (service role); RLS is on with no policies, so no other role can touch it.
-- To clear after topping up a provider:  delete from public.mavis_provider_health where provider = 'gemini';
SET lock_timeout = '3s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.mavis_provider_health (
  provider        text        PRIMARY KEY,
  unhealthy_until timestamptz NOT NULL,
  reason          text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mavis_provider_health ENABLE ROW LEVEL SECURITY;
