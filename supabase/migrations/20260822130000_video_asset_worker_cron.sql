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

-- See 20260822120000 for why: a DDL statement that waits for a lock blocks
-- everything queued behind it. Fail fast instead.
SET lock_timeout = '3s';
SET statement_timeout = '60s';

select cron.schedule(
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
