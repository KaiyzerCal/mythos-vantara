-- ============================================================
-- Fix mavis-heartbeat's cron interval: was accidentally set to every
-- 5 minutes (almost certainly copy-pasted from the adjacent
-- mavis-autonomous-engine entry, which legitimately runs that often) in
-- 20260720112103_3e3cf6c8-5d1d-44fb-9115-2817bf2f90dc.sql. The function's
-- own header comment has always said "runs hourly via pg_cron" — this
-- migration makes that true. Reported by the operator: identical "Stalled
-- Quests" Telegram alerts arriving every 5 minutes.
--
-- Reuses the cron_schedule() helper defined in that same migration
-- (unschedules any existing job with this name, then reschedules) —
-- idempotent, safe to apply on top of whatever the current schedule is.
-- ============================================================

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
  PERFORM public.cron_schedule('mavis-heartbeat', '0 * * * *', cmd);
END $$;
