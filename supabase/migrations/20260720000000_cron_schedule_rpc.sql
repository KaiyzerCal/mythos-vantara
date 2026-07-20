-- ─────────────────────────────────────────────────────────────────────────────
-- cron_schedule / cron_unschedule RPCs
--
-- mavis-cron-setup registers every row in mavis_cron_config by calling
-- rpc("cron_schedule", { jobname, schedule, command }). That RPC never existed,
-- so the entire config-table cron tier silently failed to schedule and ~10
-- edge functions (capability-audit, health-monitor, learning-engine, archivist,
-- goal-judge, so-curator, user-model-refresh, proactive-nudge, goal-review,
-- autonomous-engine) never fired.
--
-- This adds a SAFE, parameterized wrapper around cron.schedule (NOT a generic
-- exec_sql). EXECUTE is restricted to service_role, and mavis-cron-setup is a
-- service-role-only edge function, so the SQL-injection surface flagged in the
-- audit is limited to the trusted admin path.
--
-- PREREQUISITES (must be done once in the Supabase project — see notes at end):
--   1. Enable the pg_cron and pg_net extensions.
--   2. Set the DB GUCs the scheduled commands read:
--        ALTER DATABASE postgres SET app.supabase_url      = 'https://<ref>.supabase.co';
--        ALTER DATABASE postgres SET app.service_role_key  = '<service-role-key>';
--   3. POST /functions/v1/mavis-cron-setup with the service-role Bearer token.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule (or replace) a pg_cron job. Returns the job id.
CREATE OR REPLACE FUNCTION public.cron_schedule(
  jobname  text,
  schedule text,
  command  text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, extensions
AS $$
DECLARE
  job_id bigint;
BEGIN
  -- Replace any existing job with the same name so re-running setup is idempotent.
  PERFORM cron.unschedule(jobname)
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE cron.job.jobname = cron_schedule.jobname);

  SELECT cron.schedule(jobname, schedule, command) INTO job_id;
  RETURN job_id;
END;
$$;

-- Remove a scheduled job by name (no error if it does not exist).
CREATE OR REPLACE FUNCTION public.cron_unschedule(jobname text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, extensions
AS $$
BEGIN
  PERFORM cron.unschedule(jobname)
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE cron.job.jobname = cron_unschedule.jobname);
  RETURN true;
END;
$$;

-- Lock down: only the service role may schedule jobs.
REVOKE ALL ON FUNCTION public.cron_schedule(text, text, text)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cron_unschedule(text)            FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cron_schedule(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cron_unschedule(text)          TO service_role;
