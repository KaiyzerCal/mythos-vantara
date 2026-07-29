-- ============================================================
-- Operator reports mavis-heartbeat is STILL firing every 5 minutes after
-- 20260729000000_fix_heartbeat_cron_interval.sql. That migration only
-- unschedules a job with the EXACT name 'mavis-heartbeat' before
-- rescheduling — if any of the several earlier heartbeat-cron migrations
-- (20260606400000, 20260616000002, 20260618000005, 20260720112103) were
-- applied out of order, partially, or a stray job ended up under a
-- different name, an exact-name match would miss it and it would keep
-- firing independently alongside the corrected job.
--
-- This migration is broader on purpose: it finds and removes EVERY cron
-- job whose command references the mavis-heartbeat function at all
-- (regardless of jobname), then schedules exactly one, named
-- 'mavis-heartbeat', hourly. Safe to run even if
-- 20260729000000_fix_heartbeat_cron_interval.sql was never applied — this
-- one is self-contained and doesn't depend on it or its cron_schedule()
-- helper existing.
-- ============================================================

DO $$
DECLARE
  j RECORD;
  removed_count INT := 0;
BEGIN
  FOR j IN
    SELECT jobid, jobname, schedule
    FROM cron.job
    WHERE command ILIKE '%mavis-heartbeat%' OR jobname ILIKE '%heartbeat%'
  LOOP
    RAISE NOTICE 'Removing duplicate/stale heartbeat cron job: jobid=%, jobname=%, schedule=%', j.jobid, j.jobname, j.schedule;
    PERFORM cron.unschedule(j.jobid);
    removed_count := removed_count + 1;
  END LOOP;
  RAISE NOTICE 'Removed % existing heartbeat cron job(s)', removed_count;
END $$;

DO $$
DECLARE
  base_url  TEXT := 'https://wlygujlvsfimhtqsdxrx.supabase.co/functions/v1/';
  anon_key  TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndseWd1amx2c2ZpbWh0cXNkeHJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNTE3MDEsImV4cCI6MjA4OTcyNzcwMX0.ytHCLaHt2qn5s4sGzrbxI6Bj5H9eacln7pDmU7SYl5A';
  cmd TEXT;
BEGIN
  cmd := format(
    $sql$SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s','apikey','%s'),
      body := '{}'::jsonb
    );$sql$,
    base_url || 'mavis-heartbeat', anon_key, anon_key
  );
  PERFORM cron.schedule('mavis-heartbeat', '0 * * * *', cmd);
END $$;

-- Verification: this should return EXACTLY ONE row, schedule '0 * * * *'.
-- If it returns more than one row, something outside this migration
-- (e.g. a manually-created job) is also touching mavis-heartbeat.
DO $$
DECLARE remaining INT;
BEGIN
  SELECT count(*) INTO remaining FROM cron.job WHERE command ILIKE '%mavis-heartbeat%' OR jobname ILIKE '%heartbeat%';
  IF remaining != 1 THEN
    RAISE WARNING 'Expected exactly 1 mavis-heartbeat cron job after cleanup, found %. Check cron.job manually.', remaining;
  END IF;
END $$;
