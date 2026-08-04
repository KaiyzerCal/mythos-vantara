-- ============================================================
-- FIX 5 CRON JOBS THAT HAD NEVER SUCCEEDED SINCE CREATION
-- ============================================================
-- Found via cron.job_run_details: mavis-action-processor,
-- mavis-ambient-monitor, mavis-meeting-prep-check, mavis-meeting-brief,
-- and mavis-post-meeting were failing on every single scheduled run.
-- Two root causes:
--   - action-processor / meeting-prep-check queried vault.secrets
--     directly with a column named "value", which doesn't exist there
--     (the raw table's encrypted column is "secret" — the correct way
--     to read it is the vault.decrypted_secrets view, column
--     decrypted_secret)
--   - ambient-monitor / meeting-brief / post-meeting referenced
--     current_setting('app.supabase_url') / current_setting
--     ('app.service_role_key'), custom database-level GUCs that were
--     never actually set
--
-- This migration repoints all five at vault.decrypted_secrets, which
-- is also how the already-working jobs' equivalent projects (see
-- navi-exe's daily-reminders schedule) resolve the same problem.
--
-- REQUIRES two Vault secrets to already exist in this project:
--   select vault.create_secret('<this-project-url>', 'supabase_url');
--   select vault.create_secret('<service-role-key>', 'service_role_key');
-- (Already created live for wlygujlvsfimhtqsdxrx as part of this fix —
-- included here so this migration is reproducible against a fresh
-- environment.)
--
-- Verified live: manually invoked each corrected command directly
-- (not just waiting for the next scheduled tick). mavis-ambient-monitor,
-- mavis-autonomous-actions, and mavis-meeting-prep now return clean
-- 200s. mavis-meeting-brief and mavis-post-meeting get past this auth
-- fix but hit a separate, unrelated issue — an expired Google Calendar
-- OAuth token — which is not something a database migration can fix.
-- ============================================================

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'mavis-ambient-monitor'),
  command := $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/mavis-ambient-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'mavis-action-processor'),
  command := $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/mavis-autonomous-actions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"cron":true}'::jsonb
  );
  $$
);

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'mavis-meeting-prep-check'),
  command := $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/mavis-meeting-prep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"cron":true}'::jsonb
  );
  $$
);

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'mavis-meeting-brief'),
  command := $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/mavis-meeting-brief',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'mavis-post-meeting'),
  command := $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/mavis-post-meeting',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Verify with: select jobname, status, start_time, return_message
-- from cron.job_run_details r join cron.job j on j.jobid = r.jobid
-- order by start_time desc limit 20;
