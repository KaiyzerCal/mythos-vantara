
-- 1. Stripe webhook events: enable RLS, no client policies (service role bypasses RLS)
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_webhook_events FROM anon, authenticated;
GRANT ALL ON public.stripe_webhook_events TO service_role;

-- 2. Widget tables: drop permissive ALL policies, add explicit per-command policies.
-- Inserts come from the edge function using the service role (which bypasses RLS),
-- so we do NOT add any INSERT policy for anon/authenticated.
DROP POLICY IF EXISTS "user own leads" ON public.widget_leads;
CREATE POLICY "Owners can view their widget leads"
  ON public.widget_leads FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.widget_instances w WHERE w.id = widget_leads.widget_id AND w.user_id = auth.uid()));
CREATE POLICY "Owners can update their widget leads"
  ON public.widget_leads FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.widget_instances w WHERE w.id = widget_leads.widget_id AND w.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.widget_instances w WHERE w.id = widget_leads.widget_id AND w.user_id = auth.uid()));
CREATE POLICY "Owners can delete their widget leads"
  ON public.widget_leads FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.widget_instances w WHERE w.id = widget_leads.widget_id AND w.user_id = auth.uid()));

DROP POLICY IF EXISTS "user own chat logs" ON public.widget_chat_logs;
CREATE POLICY "Owners can view their widget chat logs"
  ON public.widget_chat_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.widget_instances w WHERE w.id = widget_chat_logs.widget_id AND w.user_id = auth.uid()));
CREATE POLICY "Owners can delete their widget chat logs"
  ON public.widget_chat_logs FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.widget_instances w WHERE w.id = widget_chat_logs.widget_id AND w.user_id = auth.uid()));

DROP POLICY IF EXISTS "user own usage" ON public.widget_usage_stats;
CREATE POLICY "Owners can view their widget usage"
  ON public.widget_usage_stats FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.widget_instances w WHERE w.id = widget_usage_stats.widget_id AND w.user_id = auth.uid()));

-- 3. Video projects bucket → private, owner-scoped
UPDATE storage.buckets SET public = false WHERE id = 'video-projects';

CREATE POLICY "Users can read their own video project files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'video-projects' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can upload their own video project files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'video-projects' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can update their own video project files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'video-projects' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete their own video project files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'video-projects' AND auth.uid()::text = (storage.foldername(name))[1]);

-- 4. Widgets bucket → keep public read (embed assets), but lock writes to owners
CREATE POLICY "Widget assets are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'widgets');
CREATE POLICY "Users can upload their own widget assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'widgets' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can update their own widget assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'widgets' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete their own widget assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'widgets' AND auth.uid()::text = (storage.foldername(name))[1]);

-- 5. Convert views to SECURITY INVOKER so they respect the caller's RLS
ALTER VIEW public.mavis_provider_stats SET (security_invoker = true);
ALTER VIEW public.emotion_weekly_trends SET (security_invoker = true);
ALTER VIEW public.widget_revenue_summary SET (security_invoker = true);
ALTER VIEW public.quest_with_sub_count SET (security_invoker = true);
