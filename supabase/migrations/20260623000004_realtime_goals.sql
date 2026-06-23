-- Real-time triggers + goal-directed initiative
-- Adds cron jobs for mavis-goal-agent (every 4h) and watch renewal (daily).
-- mavis_persona_memory gets a key+user_id unique index for goal progress upserts.

-- ── Unique index on persona memory for upsert on (user_id, key) ──────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_persona_memory_user_key
  ON public.mavis_persona_memory(user_id, key);

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

    -- Cron: renew Gmail push watches daily (they expire every 7 days)
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
EXCEPTION WHEN others THEN
  NULL;
END $$;
