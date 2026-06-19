
-- 1. mavis_agent_traces: enable RLS + user-scoped policy
ALTER TABLE public.mavis_agent_traces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own agent traces" ON public.mavis_agent_traces
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Service role manages agent traces" ON public.mavis_agent_traces
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. mavis_autonomous_runs: service_role only
CREATE POLICY "Service role manages autonomous runs" ON public.mavis_autonomous_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. mavis_cron_config: service_role only
CREATE POLICY "Service role manages cron config" ON public.mavis_cron_config
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. stripe_webhook_events: service_role only
CREATE POLICY "Service role manages stripe webhook events" ON public.stripe_webhook_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. mavis_capabilities: replace permissive ALL policy with read-only SELECT
DROP POLICY IF EXISTS "allow_all_authenticated" ON public.mavis_capabilities;
CREATE POLICY "Authenticated read capabilities" ON public.mavis_capabilities
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role manages capabilities" ON public.mavis_capabilities
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 6. customer_agent_messages: require matching agent for inserts
DROP POLICY IF EXISTS "public insert messages" ON public.customer_agent_messages;
CREATE POLICY "Insert messages for existing agent" ON public.customer_agent_messages
  FOR INSERT TO anon, authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.customer_agents ca WHERE ca.id = agent_id));

-- 7. realtime: tighten subscription policy (remove public:% wildcard)
DROP POLICY IF EXISTS "Authenticated users read own realtime topics" ON realtime.messages;
CREATE POLICY "Authenticated users read own realtime topics" ON realtime.messages
  FOR SELECT TO authenticated
  USING (realtime.topic() LIKE ('user:' || auth.uid()::text || '%'));
