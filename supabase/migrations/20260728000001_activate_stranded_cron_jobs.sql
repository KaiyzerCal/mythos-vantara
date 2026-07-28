-- ─────────────────────────────────────────────────────────────────────────────
-- Activate cron jobs stranded in mavis_cron_config (Execution Blueprint Stage C)
--
-- mavis_cron_config was meant to be a config table that mavis-cron-setup
-- reads and turns into real pg_cron jobs, via the cron_schedule()/
-- cron_unschedule() RPC. That RPC did not exist until
-- 20260720000000_cron_schedule_rpc.sql — every job whose ONLY registration
-- attempt went through this table (and never got a separate, direct
-- cron.schedule() call anywhere else) has therefore never actually run on a
-- schedule, silently, since it was first seeded. Confirmed via
-- docs/capability-inventory.md's full reconciliation of every
-- cron.schedule() call in supabase/migrations/ — full detail there.
--
-- Six functions confirmed stranded this way (mavis-so-curator, mavis-goal-
-- review, mavis-autonomous-engine, and mavis-proactive-nudge also had rows
-- in mavis_cron_config, but all four turned out to have a separate, real
-- cron.schedule() registration elsewhere and are NOT touched by this
-- migration):
--   mavis-capability-audit   0 */6 * * *   (20260624000002_capability_audit_cron.sql)
--   mavis-health-monitor     0 * * * *     (20260624000003_health_behavior.sql)
--   mavis-learning-engine    0 0 * * *     (20260624000003_health_behavior.sql)
--   mavis-archivist          0 4 * * 0     (20260606200000_openhuman_enhancements.sql)
--   mavis-user-model-refresh 0 3 * * *     (20260606100000_hermes_enhancements.sql)
--   mavis-goal-judge         */10 * * * *  (20260606100000_hermes_enhancements.sql,
--                                           registered there under job name
--                                           'mavis-goal-judge-review' — kept here)
--
-- Idempotent: unschedules each job name first, safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_url  TEXT;
  v_key  TEXT;
  jobs JSONB := '[
    {"name":"mavis-capability-audit",   "schedule":"0 */6 * * *",  "fn":"mavis-capability-audit",   "body":"{}"},
    {"name":"mavis-health-monitor",     "schedule":"0 * * * *",    "fn":"mavis-health-monitor",     "body":"{}"},
    {"name":"mavis-learning-engine",    "schedule":"0 0 * * *",    "fn":"mavis-learning-engine",    "body":"{}"},
    {"name":"mavis-archivist",          "schedule":"0 4 * * 0",    "fn":"mavis-archivist",          "body":"{\"scheduled\":true}"},
    {"name":"mavis-user-model-refresh", "schedule":"0 3 * * *",    "fn":"mavis-user-model-refresh", "body":"{\"trigger\":\"cron\"}"},
    {"name":"mavis-goal-judge-review",  "schedule":"*/10 * * * *", "fn":"mavis-goal-judge",         "body":"{\"trigger\":\"cron\",\"mode\":\"review_active\"}"}
  ]'::jsonb;
  j   JSONB;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL'              LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1;

  IF v_url IS NULL OR v_key IS NULL THEN
    RETURN; -- vault secrets not present; safe to skip
  END IF;

  FOR j IN SELECT * FROM jsonb_array_elements(jobs) LOOP
    BEGIN
      PERFORM cron.unschedule(jb.jobid) FROM cron.job jb WHERE jb.jobname = (j->>'name');
    EXCEPTION WHEN others THEN NULL; END;

    PERFORM cron.schedule(
      j->>'name',
      j->>'schedule',
      format(
        $cron$
        SELECT net.http_post(
          url     := %L || '/functions/v1/%s',
          headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || %L),
          body    := %L::jsonb
        );
        $cron$,
        v_url, j->>'fn', v_key, j->>'body'
      )
    );
  END LOOP;
EXCEPTION WHEN others THEN
  NULL; -- cron extension may not be enabled; safe to skip
END $$;
