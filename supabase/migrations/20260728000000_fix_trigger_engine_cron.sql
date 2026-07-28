-- ─────────────────────────────────────────────────────────────────────────────
-- Fix mavis-trigger-engine cron scheduling (Execution Blueprint Stage C)
--
-- Found via static reconciliation of every cron.schedule() call in
-- supabase/migrations/ (docs/capability-inventory.md has full detail):
--
-- 1. 20260623000003_trigger_engine.sql registered 'mavis-trigger-engine-10m'
--    every 10 minutes, correctly using the SUPABASE_SERVICE_ROLE_KEY vault
--    secret.
-- 2. 20260625000002_trigger_engine_5min.sql unconditionally unscheduled that
--    job, then tried to register 'mavis-trigger-engine-5m' every 5 minutes —
--    but looked up the vault secret under the name 'SERVICE_ROLE_KEY'
--    (missing the SUPABASE_ prefix used everywhere else in this codebase,
--    including that same migration's own predecessor). If no vault secret
--    exists under that exact name, v_key is NULL and the registration is
--    silently skipped (the IF guard exists specifically to avoid a hard
--    failure) — meaning the 5-minute job most likely never got created at
--    all, while the 10-minute job it was meant to replace was already gone.
-- 3. 20260720112103_...sql separately registered a THIRD, differently-named
--    job — plain 'mavis-trigger-engine' — every 10 minutes, this time using
--    a hardcoded anon key rather than the service-role key any other
--    cron-triggered internal function in this codebase uses.
--
-- Net likely effect on live state: the trigger engine has probably been
-- running every 10 minutes (not the intended 5) via weaker anon-key auth
-- (not verified live — Supabase MCP access was blocked this session).
--
-- This migration is idempotent and safe to re-run: it unschedules every
-- possible job-name variant from the three migrations above, then registers
-- exactly one, at the clearly-intended 5-minute cadence, using the correct
-- SUPABASE_SERVICE_ROLE_KEY vault secret name.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN PERFORM cron.unschedule('mavis-trigger-engine-10m'); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-trigger-engine-5m');  EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-trigger-engine');     EXCEPTION WHEN others THEN NULL; END $$;

DO $$
DECLARE
  v_url  TEXT;
  v_key  TEXT;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL'              LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1;

  IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
    PERFORM cron.schedule(
      'mavis-trigger-engine-5m',
      '*/5 * * * *',
      format(
        $cron$
        SELECT net.http_post(
          url     := %L || '/functions/v1/mavis-trigger-engine',
          headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || %L),
          body    := '{"action":"run"}'::jsonb
        );
        $cron$,
        v_url, v_key
      )
    );
  END IF;
EXCEPTION WHEN others THEN
  NULL; -- cron extension may not be enabled; safe to skip
END $$;
