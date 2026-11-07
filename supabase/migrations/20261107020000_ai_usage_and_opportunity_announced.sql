-- 1) mavis_ai_usage: one row per AI cascade call (lane, job label, provider, latency,
--    estimated tokens/cost) so spend can be attributed instead of guessed. Written by
--    edge functions with the service role; RLS on with no policies.
--    The old mavis_llm_calls log silently stopped in June because mavis-chat wrote a
--    column named latency_ms while the table has duration_ms.
-- 2) mavis_opportunities.announced_at: each opportunity is announced once.
SET lock_timeout = '3s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.mavis_ai_usage (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  lane           text        NOT NULL,
  label          text,
  provider       text        NOT NULL,
  duration_ms    integer,
  est_in_tokens  integer,
  est_out_tokens integer,
  est_cost_usd   numeric(12,6),
  success        boolean     NOT NULL DEFAULT true,
  error          text
);
ALTER TABLE public.mavis_ai_usage ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS mavis_ai_usage_created_idx ON public.mavis_ai_usage (created_at DESC);

ALTER TABLE public.mavis_opportunities ADD COLUMN IF NOT EXISTS announced_at timestamptz;
