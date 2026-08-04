-- ============================================================
-- Follow-up to 20260804000000_fix_broken_cron_jobs.sql, found while
-- applying the batch of previously-authored-but-never-deployed
-- migrations from the missing-table triage (20260517200000 through
-- 20260727000000 — 37 files, ~2300 lines, written between mid-May
-- and late-July but never pushed to this live database).
--
-- Four more cron jobs in those files used the same broken
-- current_setting('app.supabase_url') / current_setting
-- ('app.service_role_key') pattern as the 5 fixed earlier — those
-- GUCs were never set on this project, so every run of these jobs
-- would have failed with a null URL. Rewritten to vault.decrypted_secrets,
-- same fix as before. Applied live already (as part of applying each
-- source file); this migration makes that reproducible from a fresh
-- environment without editing the original files.
-- ============================================================

DO $$ BEGIN PERFORM cron.unschedule('mavis-nora-engage'); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  PERFORM cron.schedule(
    'mavis-nora-engage',
    '*/15 * * * *',
    $c$
      SELECT net.http_post(
        url      := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/mavis-nora-engage',
        headers  := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
        ),
        body     := '{}'::jsonb
      );
    $c$
  );
EXCEPTION WHEN unique_violation THEN NULL; END $$;

DO $$ BEGIN PERFORM cron.unschedule('mavis-hn-daily'); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  PERFORM cron.schedule('mavis-hn-daily', '0 8 * * *',
    $c$SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/mavis-hn-digest',
      headers := jsonb_build_object('Content-Type','application/json'),
      body := '{}'::jsonb
    ) AS request_id$c$);
EXCEPTION WHEN unique_violation THEN NULL; END $$;

DO $$ BEGIN PERFORM cron.unschedule('mavis-weekly-eval'); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  PERFORM cron.schedule(
    'mavis-weekly-eval',
    '0 2 * * 6',
    $c$
    SELECT net.http_post(
      url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/mavis-eval',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
      ),
      body    := jsonb_build_object('action', 'evaluate_conversations')
    ) AS request_id
    $c$
  );
EXCEPTION WHEN unique_violation THEN NULL; END $$;

DO $$ BEGIN PERFORM cron.unschedule('mavis-signal-watcher'); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  PERFORM cron.schedule('mavis-signal-watcher', '*/15 * * * *',
    $c$SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/mavis-signal-watcher',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')),
      body := jsonb_build_object('action', 'watch_signals')
    ) AS request_id$c$
  );
EXCEPTION WHEN unique_violation THEN NULL; END $$;

-- ============================================================
-- 20260609000001_prymal_client_schema.sql and
-- 20260609000002_prymal_gmb_reviews.sql created 9 prymal_* tables
-- with no RLS at all — meaning any authenticated (or anon,
-- depending on key exposure) client could read/write every
-- PrymalAI client's data via PostgREST directly. Same class of
-- privilege-escalation bug fixed earlier this session for
-- profiles.subscription_tier (navi-exe) and widget_instances
-- (mythos-vantara). These tables are only ever accessed by
-- prymal-*-agent edge functions using the service role key
-- (confirmed: no src/pages/*.tsx reference any prymal_* table),
-- so RLS-enabled-with-no-policies is the correct fix — service
-- role bypasses RLS automatically, everyone else is denied.
-- ============================================================

ALTER TABLE public.prymal_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prymal_client_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prymal_approval_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prymal_inbound_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prymal_social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prymal_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prymal_intel_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prymal_outreach_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prymal_gmb_reviews ENABLE ROW LEVEL SECURITY;
