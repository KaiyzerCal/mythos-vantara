-- Hermes-inspired upgrades: usage tracking, source tagging, session lineage,
-- structured summaries, and council member lifecycle management.

-- ── 1. mavis_usage_log — per-request LLM cost tracking ───────────────────────
CREATE TABLE IF NOT EXISTS public.mavis_usage_log (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  persona_id         uuid,
  session_type       text         NOT NULL CHECK (session_type IN ('mavis','council','persona','group')),
  model              text         NOT NULL DEFAULT '',
  input_tokens       integer      NOT NULL DEFAULT 0,
  output_tokens      integer      NOT NULL DEFAULT 0,
  cache_read_tokens  integer      NOT NULL DEFAULT 0,
  cache_write_tokens integer      NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(12,8) NOT NULL DEFAULT 0,
  created_at         timestamptz  NOT NULL DEFAULT now()
);
ALTER TABLE public.mavis_usage_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "own usage log" ON public.mavis_usage_log FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_usage_log_user_created
  ON public.mavis_usage_log(user_id, created_at DESC);

-- ── 2. mavis_persona_memory enhancements ──────────────────────────────────────
-- Add source column for platform tracking (app / voice / telegram / council / group)
ALTER TABLE public.mavis_persona_memory
  ADD COLUMN IF NOT EXISTS source text;

-- Allow 'summary' role for background review fork entries
ALTER TABLE public.mavis_persona_memory
  DROP CONSTRAINT IF EXISTS mavis_persona_memory_role_check;
ALTER TABLE public.mavis_persona_memory
  ADD CONSTRAINT mavis_persona_memory_role_check
    CHECK (role IN ('user', 'assistant', 'summary'));

-- Make persona_id nullable so council-member summary rows don't need a personas FK
ALTER TABLE public.mavis_persona_memory
  ALTER COLUMN persona_id DROP NOT NULL;

-- ── 3. council_sessions: lineage + summary ────────────────────────────────────
ALTER TABLE public.council_sessions
  ADD COLUMN IF NOT EXISTS parent_session_id uuid REFERENCES council_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS summary           text;

DO $$ BEGIN
  CREATE INDEX idx_council_sessions_parent
    ON council_sessions(parent_session_id)
    WHERE parent_session_id IS NOT NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 4. councils: member lifecycle state machine ───────────────────────────────
ALTER TABLE public.councils
  ADD COLUMN IF NOT EXISTS last_used_at  timestamptz,
  ADD COLUMN IF NOT EXISTS tactic_state text NOT NULL DEFAULT 'active'
    CHECK (tactic_state IN ('active','stale','archived','pinned'));

DO $$ BEGIN
  CREATE INDEX idx_councils_tactic_state
    ON councils(user_id, tactic_state);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
