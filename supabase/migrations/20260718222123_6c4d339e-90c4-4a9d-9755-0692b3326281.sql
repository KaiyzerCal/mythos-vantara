
-- loose_threads
CREATE TABLE IF NOT EXISTS public.loose_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'chat',
  source_ref TEXT,
  context TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.loose_threads TO authenticated;
GRANT ALL ON public.loose_threads TO service_role;
ALTER TABLE public.loose_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own loose_threads" ON public.loose_threads
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS loose_threads_user_status_idx ON public.loose_threads(user_id, status);
CREATE INDEX IF NOT EXISTS loose_threads_source_ref_idx ON public.loose_threads(source_ref);
CREATE TRIGGER update_loose_threads_updated_at BEFORE UPDATE ON public.loose_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- mavis_meeting_briefs_sent
CREATE TABLE IF NOT EXISTS public.mavis_meeting_briefs_sent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_ref TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_ref)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mavis_meeting_briefs_sent TO authenticated;
GRANT ALL ON public.mavis_meeting_briefs_sent TO service_role;
ALTER TABLE public.mavis_meeting_briefs_sent ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own meeting_briefs_sent" ON public.mavis_meeting_briefs_sent
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- contacts additions
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS pipeline_name TEXT,
  ADD COLUMN IF NOT EXISTS pipeline_stage TEXT,
  ADD COLUMN IF NOT EXISTS pipeline_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enrichment JSONB,
  ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS contacts_pipeline_name_idx ON public.contacts(user_id, pipeline_name);
