-- Cron entry for the video asset worker.
--
-- Every 5 minutes, matching mavis-action-processor and mavis-autonomous-engine.
-- A production is minutes of wall clock across paid providers, so it cannot be
-- completed inside one request — each tick does a bounded slice and returns.
--
-- Cadence note: BEATS_PER_TICK is 4, so a 10-beat production takes roughly
-- three ticks (~15 minutes) end to end in stills mode. That is deliberate.
-- Raising the frequency would not make one production finish sooner, because
-- the limit is provider latency per beat, not how often the worker wakes up.
--
-- Follows the same secret-lookup shape as 20260512200300_mavis_cron_schedule.sql:
-- the URL and service key come from vault.decrypted_secrets rather than being
-- baked into the schedule.
--
-- NOTE: this backend is Lovable-managed. Committing this file does NOT apply
-- it — see CLAUDE.md.
--
-- DEPENDS ON A DEPLOYED FUNCTION. This job is useless until
-- supabase/functions/mavis-video-asset-worker is deployed, and worse than
-- useless while it is not: it POSTs every five minutes and gets
-- {"code":"NOT_FOUND"} back, 288 times a day. Verified by probe on
-- 2026-08-27, which is why the live job was left scheduled but INACTIVE.
--
-- After the functions deploy, turn it on:
--   select cron.alter_job(
--     (select jobid from cron.job where jobname='mavis-video-asset-worker'),
--     active := true);
--
-- Check the target first, so this is not enabled on faith:
--   select status_code from net._http_response where id = (
--     select net.http_post(
--       url := (select decrypted_secret from vault.decrypted_secrets where name='supabase_url')
--              || '/functions/v1/mavis-video-asset-worker',
--       headers := jsonb_build_object('Content-Type','application/json',
--                  'Authorization','Bearer ' || (select decrypted_secret
--                    from vault.decrypted_secrets where name='service_role_key')),
--       body := '{"action":"tick"}'::jsonb));

-- See 20260822120000 for why: a statement that waits for a lock blocks
-- everything queued behind it. Fail fast instead.
--
-- The session-level SET is for a plain psql/CLI apply; the set_config inside
-- the block is what holds when this is delivered through a pooler that may run
-- the body on a different session than the SET. Same reasoning as
-- 20260822120000's header, note 1.
SET lock_timeout = '3s';
SET statement_timeout = '60s';

DO $mig$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '60s', true);

  -- cron.schedule upserts on jobname, so re-running this replaces the entry
  -- rather than stacking a duplicate schedule.
  PERFORM cron.schedule(
  'mavis-video-asset-worker',
  '*/5 * * * *',
  $$
  select net.http_post(
    url         := (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_url') || '/functions/v1/mavis-video-asset-worker',
    headers     := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
                   ),
    body        := '{"action":"tick"}'::jsonb,
    -- Longer than the other jobs: a tick may spend most of its budget waiting
    -- on image generation for several beats before it can report back.
    timeout_milliseconds := 120000
  ) as request_id;
  $$
  );
END $mig$;
