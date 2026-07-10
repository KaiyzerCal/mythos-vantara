
-- 1) Enable RLS on unprotected tables and add owner-scoped policies
ALTER TABLE public.mavis_behavioral_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own behavioral signals" ON public.mavis_behavioral_signals
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.mavis_email_watches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own email watches" ON public.mavis_email_watches
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.mavis_learned_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own learned preferences" ON public.mavis_learned_preferences
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Operational tables: service_role only (RLS on with no permissive policy blocks anon/authenticated)
ALTER TABLE public.mavis_function_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavis_worldmonitor_cache ENABLE ROW LEVEL SECURITY;

-- Financial sync cursors: restrict to owner via join to plaid_items
ALTER TABLE public.plaid_sync_cursors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own plaid sync cursors" ON public.plaid_sync_cursors
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.plaid_items pi WHERE pi.item_id = plaid_sync_cursors.item_id AND pi.user_id = auth.uid()));

-- 2) Drop always-true (USING (true) / WITH CHECK (true)) policies.
-- service_role bypasses RLS entirely, so these permissive policies are redundant
-- and only produce lint noise.
DROP POLICY IF EXISTS "Service role only access" ON public.whoop_tokens;
DROP POLICY IF EXISTS "Service role manages agent traces" ON public.mavis_agent_traces;
DROP POLICY IF EXISTS "Service role manages autonomous runs" ON public.mavis_autonomous_runs;
DROP POLICY IF EXISTS "Service role manages cron config" ON public.mavis_cron_config;
DROP POLICY IF EXISTS "Service role manages stripe webhook events" ON public.stripe_webhook_events;
DROP POLICY IF EXISTS "Service role manages capabilities" ON public.mavis_capabilities;
DROP POLICY IF EXISTS "Service role manages action queue" ON public.mavis_action_queue;
DROP POLICY IF EXISTS "Service role manages autonomy" ON public.mavis_autonomy_settings;
DROP POLICY IF EXISTS "Service role manages chains" ON public.mavis_causal_chains;
DROP POLICY IF EXISTS "Service role manages evolution" ON public.mavis_evolution_log;
DROP POLICY IF EXISTS "Service role manages intel" ON public.mavis_market_intel;
DROP POLICY IF EXISTS "Service role manages preps" ON public.mavis_meeting_preps;
DROP POLICY IF EXISTS "Service role manages outcomes" ON public.mavis_outcome_events;
DROP POLICY IF EXISTS "Service role manages outreach drafts" ON public.mavis_outreach_drafts;
DROP POLICY IF EXISTS "Service role manages form submissions" ON public.website_form_submissions;
DROP POLICY IF EXISTS "Service role manages widget usage" ON public.widget_usage_stats;
DROP POLICY IF EXISTS "Service role bypass" ON public.mavis_user_integrations;
DROP POLICY IF EXISTS "service role autonomy" ON public.mavis_autonomy_config;
DROP POLICY IF EXISTS "service role trigger subs" ON public.mavis_trigger_subscriptions;
DROP POLICY IF EXISTS "service role trigger log" ON public.mavis_trigger_log;
DROP POLICY IF EXISTS "Service role full access action queue" ON public.mavis_action_queue;
DROP POLICY IF EXISTS "Service role full access campaigns" ON public.mavis_campaigns;
DROP POLICY IF EXISTS "Service role can manage briefs" ON public.mavis_daily_briefs;
DROP POLICY IF EXISTS "Service role can manage scores" ON public.mavis_daily_scores;

-- 3) Revoke EXECUTE on SECURITY DEFINER functions from anon/authenticated.
-- These are trigger functions or invoked only from edge functions using service_role.
REVOKE EXECUTE ON FUNCTION public.mavis_learn_from_approval() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mavis_dispatch_event(jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_journal_created() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_expense_logged() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_quest_status_changed() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_task_completed() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_persona_memory(vector, uuid, double precision, integer) FROM anon, authenticated;
