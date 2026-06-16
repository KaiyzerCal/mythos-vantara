-- Per-persona memory persistence.
-- Audit gap: personas reset on every conversation because mavis-chat has no
-- mechanism to store or retrieve persona-specific memory. This table and its
-- accompanying index allow each persona to accumulate a persistent memory of
-- interactions, injected back when that persona is next activated.

CREATE TABLE IF NOT EXISTS public.mavis_persona_memory (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  persona_id   uuid NOT NULL,  -- FK to personas table (relaxed: no hard FK so table order is flexible)
  persona_name text NOT NULL,
  role         text NOT NULL CHECK (role IN ('user', 'assistant')),
  content      text NOT NULL,
  importance   integer NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 10),
  session_id   text,
  consolidated boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mavis_persona_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users own persona memory"
  ON public.mavis_persona_memory FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "service role manages persona memory"
  ON public.mavis_persona_memory FOR ALL USING (auth.role() = 'service_role');

-- Primary retrieval pattern: get recent memory for a specific persona
CREATE INDEX IF NOT EXISTS idx_persona_memory_user_persona
  ON public.mavis_persona_memory(user_id, persona_id, created_at DESC);

-- Consolidation sweep: find unconsolidated entries older than 7 days
CREATE INDEX IF NOT EXISTS idx_persona_memory_unconsolidated
  ON public.mavis_persona_memory(user_id, consolidated, created_at)
  WHERE consolidated = false;

-- Retention: weekly cron prunes consolidated persona memory older than 60 days.
-- Uses same vault secret pattern as Round 1 crons (consistent with 20260512200300).
SELECT cron.schedule(
  'mavis-persona-memory-retention',
  '0 3 * * 0',  -- Sundays at 3 AM UTC (after self-evolve at 3 AM, before world-model at 5 AM)
  format(
    $$
    SELECT net.http_post(
      url := %L || '/functions/v1/mavis-autonomous-runner',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
      ),
      body := '{"trigger":"retention","scope":"persona_memory"}'
    );
    $$,
    current_setting('app.supabase_url', true)
  )
);
