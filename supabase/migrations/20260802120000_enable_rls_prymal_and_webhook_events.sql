-- ============================================================
-- Enable RLS on 9 tables that were created without it
-- ============================================================
-- prymal_client_integrations, prymal_clients' 7 sibling tables, and
-- webhook_events were never given `ENABLE ROW LEVEL SECURITY`. In a
-- standard Supabase project RLS is the only thing gating row access for
-- the `authenticated` role — without it, any signed-in user can read or
-- write these rows via a plain REST call, regardless of what the
-- frontend UI actually queries.
--
-- None of these tables has a user_id column meaningful to end-user
-- scoping — they're the PrymalAI white-label client-management tables
-- and a webhook log, both meant to be touched only by edge functions
-- using the service-role key (which bypasses RLS regardless of policies).
-- So the fix is just enabling RLS with no policies: that locks out
-- anon/authenticated access entirely while leaving service-role access
-- (the only access these tables are actually designed for) unaffected.
--
-- prymal_clients itself already has RLS enabled with zero policies (see
-- 20260612000001_missing_tables.sql) — this migration brings its 8
-- sibling tables plus webhook_events in line with that same safe state.

ALTER TABLE IF EXISTS public.prymal_client_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.prymal_contacts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.prymal_inbound_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.prymal_social_posts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.prymal_outreach_sequences   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.prymal_gmb_reviews          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.prymal_intel_briefings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.prymal_approval_queue       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.webhook_events              ENABLE ROW LEVEL SECURITY;
