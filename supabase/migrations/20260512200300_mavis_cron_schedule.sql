-- ═══════════════════════════════════════════════════════════
-- MAVIS CRON SCHEDULE
-- Schedules the task executor and nightly consolidation
-- via pg_cron + pg_net (both available in Supabase by default).
--
-- IMPORTANT: Replace <YOUR_SUPABASE_PROJECT_REF> with your actual
-- project reference (found in Supabase dashboard → Project Settings → General).
-- The cron jobs below call edge functions via HTTP using the service role key
-- stored in vault.decrypted_secrets (set up via Supabase Vault).
--
-- To set up vault secrets (run once in SQL editor):
--   select vault.create_secret('<your-supabase-url>', 'supabase_url');
--   select vault.create_secret('<your-service-role-key>', 'service_role_key');
-- ═══════════════════════════════════════════════════════════

-- Enable required extensions (already enabled in Supabase, safe to run)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ─────────────────────────────────────────────────────────────
-- TASK EXECUTOR — every 15 minutes
-- Picks up pending mavis_tasks and executes them autonomously
-- ─────────────────────────────────────────────────────────────
select cron.schedule(
  'mavis-task-executor',
  '*/15 * * * *',
  $$
  select net.http_post(
    url         := (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_url') || '/functions/v1/mavis-task-executor',
    headers     := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
                   ),
    body        := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) as request_id;
  $$
);

-- ─────────────────────────────────────────────────────────────
-- NIGHTLY MEMORY CONSOLIDATION — 3:00 AM UTC daily
-- Extracts Layer 1 (knowledge) + Layer 3 (tacit) from Layer 2 (session logs)
-- ─────────────────────────────────────────────────────────────
select cron.schedule(
  'mavis-nightly-consolidation',
  '0 3 * * *',
  $$
  select net.http_post(
    url         := (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_url') || '/functions/v1/mavis-consolidate',
    headers     := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
                   ),
    body        := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;
  $$
);

-- ─────────────────────────────────────────────────────────────
-- DAILY BRIEF SEEDING — 7:00 AM UTC daily
-- Creates a pending daily_brief task for every active user
-- so it runs automatically each morning without a chat trigger
-- ─────────────────────────────────────────────────────────────
select cron.schedule(
  'mavis-daily-brief-seed',
  '0 7 * * *',
  $$
  insert into mavis_tasks (user_id, type, description, status)
  select distinct user_id,
         'daily_brief',
         'Automated morning brief — ' || to_char(now(), 'YYYY-MM-DD'),
         'pending'
  from   mavis_memory
  where  created_at > now() - interval '30 days'
  on conflict do nothing;
  $$
);

-- ─────────────────────────────────────────────────────────────
-- IDLE QUEST SCAN — every Sunday at 9:00 AM UTC
-- Detects quests with no activity for 7+ days
-- ─────────────────────────────────────────────────────────────
select cron.schedule(
  'mavis-idle-quest-scan',
  '0 9 * * 0',
  $$
  insert into mavis_tasks (user_id, type, description, status)
  select distinct user_id,
         'check_idle_quests',
         'Weekly idle quest scan — ' || to_char(now(), 'YYYY-MM-DD'),
         'pending'
  from   quests
  where  status = 'active'
  and    updated_at < now() - interval '7 days'
  on conflict do nothing;
  $$
);

-- View scheduled jobs (useful for verification)
-- select jobid, schedule, command, jobname from cron.job;
