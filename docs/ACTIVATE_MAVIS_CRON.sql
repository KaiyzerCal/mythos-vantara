-- ============================================================================
-- MAVIS — ACTIVATE AUTONOMOUS CRON  (one-shot, idempotent, safe to re-run)
-- Paste this whole file into the Lovable / Supabase SQL editor and Run.
--
-- BEFORE RUNNING: replace <PASTE_SERVICE_ROLE_KEY_HERE> on line 20 with your
-- Supabase service-role key (Dashboard → Project Settings → API → service_role).
-- The project URL is already filled in for project wlygujlvsfimhtqsdxrx.
-- ============================================================================

-- ── 1. Extensions ───────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── 2. Database GUCs the cron commands read ─────────────────────────────────
-- These persist at the database level; pg_cron opens fresh sessions that read
-- them, so they take effect on the next job run.
ALTER DATABASE postgres SET app.supabase_url     = 'https://wlygujlvsfimhtqsdxrx.supabase.co';
ALTER DATABASE postgres SET app.service_role_key = '<PASTE_SERVICE_ROLE_KEY_HERE>';

-- Make the settings visible to THIS session too, so the schedule calls below
-- (and any immediate manual test) resolve current_setting() without a reconnect.
SET app.supabase_url     = 'https://wlygujlvsfimhtqsdxrx.supabase.co';
SET app.service_role_key = '<PASTE_SERVICE_ROLE_KEY_HERE>';

-- ── 3. cron_schedule / cron_unschedule RPCs ─────────────────────────────────
-- Used by the mavis-cron-setup edge function. Safe, parameterized wrapper
-- around cron.schedule; EXECUTE restricted to the service role.
CREATE OR REPLACE FUNCTION public.cron_schedule(
  jobname text, schedule text, command text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron, extensions AS $fn$
DECLARE job_id bigint;
BEGIN
  PERFORM cron.unschedule(jobname)
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE cron.job.jobname = cron_schedule.jobname);
  SELECT cron.schedule(jobname, schedule, command) INTO job_id;
  RETURN job_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cron_unschedule(jobname text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron, extensions AS $fn$
BEGIN
  PERFORM cron.unschedule(jobname)
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE cron.job.jobname = cron_unschedule.jobname);
  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.cron_schedule(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cron_unschedule(text)           FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cron_schedule(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cron_unschedule(text)           TO service_role;

-- ── 4. Helper: schedule an edge-function cron job by name ────────────────────
-- Wraps the net.http_post pattern so the job list below stays readable.
CREATE OR REPLACE FUNCTION public.mavis_schedule_fn(
  job_name text, schedule text, fn_name text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron, extensions AS $fn$
BEGIN
  PERFORM cron.unschedule(job_name)
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE cron.job.jobname = job_name);
  PERFORM cron.schedule(job_name, schedule, format($cmd$
    SELECT net.http_post(
      url     := current_setting('app.supabase_url') || '/functions/v1/%s',
      headers := jsonb_build_object(
                   'Content-Type','application/json',
                   'Authorization','Bearer ' || current_setting('app.service_role_key')),
      body    := '{}'::jsonb
    );
  $cmd$, fn_name));
END;
$fn$;

-- ── 5. Schedule the jobs that were never firing ─────────────────────────────
-- (These lived only in mavis_cron_config, which never registered because the
--  cron_schedule RPC did not exist. Now scheduled directly.)
SELECT public.mavis_schedule_fn('mavis-workflow-scheduler',  '*/5 * * * *',  'mavis-autonomous-engine');
SELECT public.mavis_schedule_fn('mavis-goal-judge-review',   '*/10 * * * *', 'mavis-goal-judge');
SELECT public.mavis_schedule_fn('mavis-health-monitor',      '0 * * * *',    'mavis-health-monitor');
SELECT public.mavis_schedule_fn('mavis-proactive-nudge',     '0 */4 * * *',  'mavis-proactive-nudge');
SELECT public.mavis_schedule_fn('mavis-capability-audit',    '0 */6 * * *',  'mavis-capability-audit');
SELECT public.mavis_schedule_fn('mavis-user-model-refresh',  '0 3 * * *',    'mavis-user-model-refresh');
SELECT public.mavis_schedule_fn('mavis-goal-review',         '0 21 * * *',   'mavis-goal-review');
SELECT public.mavis_schedule_fn('mavis-learning-engine',     '0 0 * * *',    'mavis-learning-engine');
SELECT public.mavis_schedule_fn('mavis-archivist',           '0 4 * * 0',    'mavis-archivist');
SELECT public.mavis_schedule_fn('mavis-so-curator',          '0 2 * * 0',    'mavis-so-curator');

-- ── 6. Verify — should list all 10 jobs above plus any from earlier setups ──
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname IN (
  'mavis-workflow-scheduler','mavis-goal-judge-review','mavis-health-monitor',
  'mavis-proactive-nudge','mavis-capability-audit','mavis-user-model-refresh',
  'mavis-goal-review','mavis-learning-engine','mavis-archivist','mavis-so-curator'
)
ORDER BY jobname;

-- ============================================================================
-- 7. MIGRATION: gmail_messages  (email triage + priority-email alerts)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.gmail_messages (
  id           text        PRIMARY KEY,               -- Gmail message id
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id    text,
  subject      text        NOT NULL DEFAULT '',
  from_email   text        NOT NULL DEFAULT '',
  from_name    text,
  snippet      text,
  body         text,
  labels       text[]      NOT NULL DEFAULT '{}',
  is_read      boolean     NOT NULL DEFAULT true,
  received_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gmail_messages_user_received
  ON public.gmail_messages (user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_gmail_messages_user_unread
  ON public.gmail_messages (user_id, is_read, received_at DESC);
ALTER TABLE public.gmail_messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "own gmail messages" ON public.gmail_messages
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 8. VERIFY the tables exist
-- ============================================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('gmail_messages','mavis_relationship_health')
ORDER BY table_name;

-- NOTE: the cron_schedule RPC (section 3) and mavis_relationship_health
-- (already created by migration 20260603000036) cover the rest. Nothing else
-- to paste — this single file activates cron + all new schema.
