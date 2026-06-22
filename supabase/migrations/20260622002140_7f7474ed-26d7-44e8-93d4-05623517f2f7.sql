
-- Add service_role write policies and tighten user-scoped write policies for tables missing INSERT/UPDATE/DELETE protection.

-- mavis_action_queue
CREATE POLICY "Users manage own actions" ON public.mavis_action_queue
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role manages action queue" ON public.mavis_action_queue
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- mavis_autonomy_settings
CREATE POLICY "Users manage own autonomy" ON public.mavis_autonomy_settings
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role manages autonomy" ON public.mavis_autonomy_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- mavis_causal_chains
CREATE POLICY "Users manage own chains" ON public.mavis_causal_chains
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role manages chains" ON public.mavis_causal_chains
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- mavis_evolution_log
CREATE POLICY "Users manage own evolution" ON public.mavis_evolution_log
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role manages evolution" ON public.mavis_evolution_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- mavis_market_intel
CREATE POLICY "Users manage own intel" ON public.mavis_market_intel
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role manages intel" ON public.mavis_market_intel
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- mavis_meeting_preps
CREATE POLICY "Users manage own preps" ON public.mavis_meeting_preps
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role manages preps" ON public.mavis_meeting_preps
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- mavis_outcome_events
CREATE POLICY "Users manage own outcomes" ON public.mavis_outcome_events
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role manages outcomes" ON public.mavis_outcome_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- mavis_outreach_drafts: add WITH CHECK to user policy, restrict service policy to service_role role
DROP POLICY IF EXISTS "users own outreach drafts" ON public.mavis_outreach_drafts;
DROP POLICY IF EXISTS "service role manages all outreach drafts" ON public.mavis_outreach_drafts;
CREATE POLICY "Users manage own outreach drafts" ON public.mavis_outreach_drafts
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role manages outreach drafts" ON public.mavis_outreach_drafts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- website_form_submissions: writes only via service_role (edge functions process public form posts)
CREATE POLICY "Service role manages form submissions" ON public.website_form_submissions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- widget_usage_stats: writes only via service_role (recorded server-side)
CREATE POLICY "Service role manages widget usage" ON public.widget_usage_stats
  FOR ALL TO service_role USING (true) WITH CHECK (true);
