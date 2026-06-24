-- Real-time triggers + goal-directed initiative
-- Creates mavis_persona_memory for structured MAVIS notes (key/value store).
-- Adds pg_cron jobs for goal agent (every 4h) and Gmail watch renewal (daily).

-- ── mavis_persona_memory ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.mavis_persona_memory (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key         text        NOT NULL,
  value       text        NOT NULL,
  category    text        NOT NULL DEFAULT 'general',
  importance  integer     NOT NULL DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  source      text        NOT NULL DEFAULT 'mavis',
  role        text        NOT NULL DEFAULT 'system',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_persona_memory_user_key
  ON public.mavis_persona_memory(user_id, key);

CREATE INDEX IF NOT EXISTS idx_persona_memory_user_cat
  ON public.mavis_persona_memory(user_id, category);

ALTER TABLE public.mavis_persona_memory ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mavis_persona_memory' AND policyname = 'Users manage own persona memory'
  ) THEN
    CREATE POLICY "Users manage own persona memory"
      ON public.mavis_persona_memory FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mavis_persona_memory' AND policyname = 'Service role full access persona memory'
  ) THEN
    CREATE POLICY "Service role full access persona memory"
      ON public.mavis_persona_memory FOR ALL
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── Cron: goal agent every 4 hours ──────────────────────────────────────────

DO $$
DECLARE
  v_url  text;
  v_key  text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL'               LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY'  LIMIT 1;

  IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
    PERFORM cron.schedule(
      'mavis-goal-agent-4h',
      '0 */4 * * *',
      format(
        $cron$
        SELECT net.http_post(
          url     := %L || '/functions/v1/mavis-goal-agent',
          headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || %L),
          body    := '{"action":"run"}'::jsonb
        );
        $cron$,
        v_url, v_key
      )
    );

    PERFORM cron.schedule(
      'mavis-gmail-watch-renew-daily',
      '0 6 * * *',
      format(
        $cron$
        SELECT net.http_post(
          url     := %L || '/functions/v1/mavis-gmail-watch',
          headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || %L),
          body    := '{"action":"renew"}'::jsonb
        );
        $cron$,
        v_url, v_key
      )
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
