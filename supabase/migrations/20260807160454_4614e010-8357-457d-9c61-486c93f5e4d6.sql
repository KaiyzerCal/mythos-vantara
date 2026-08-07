ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nora_engagement_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_dispatch_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.nora_engagement_log FROM anon, authenticated;
GRANT ALL ON public.api_usage TO service_role;
GRANT ALL ON public.nora_engagement_log TO service_role;
GRANT ALL ON public.webhook_dispatch_log TO service_role;
GRANT SELECT ON public.api_usage TO authenticated;
GRANT SELECT ON public.webhook_dispatch_log TO authenticated;

CREATE POLICY "Users read own api usage" ON public.api_usage
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users read own webhook dispatch log" ON public.webhook_dispatch_log
  FOR SELECT TO authenticated USING (auth.uid() = user_id);