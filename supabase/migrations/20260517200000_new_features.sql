-- ============================================================
-- MAVIS — New Features Migration
-- Contacts | Health Metrics | MAVIS Insights | Calendar Events
-- ============================================================

-- Contacts (real people tracker)
CREATE TABLE IF NOT EXISTS public.contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relationship_type TEXT DEFAULT 'personal',
  last_contact_at TIMESTAMPTZ,
  follow_up_date DATE,
  notes TEXT DEFAULT '',
  tags TEXT[] DEFAULT '{}',
  profile JSONB DEFAULT '{}',
  interaction_count INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own contacts" ON public.contacts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX idx_contacts_user ON public.contacts(user_id);

-- Contact interactions log
CREATE TABLE IF NOT EXISTS public.contact_interactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  interaction_type TEXT DEFAULT 'note',
  notes TEXT NOT NULL DEFAULT '',
  sentiment TEXT DEFAULT 'neutral',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.contact_interactions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own interactions" ON public.contact_interactions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Health metrics (Oura / Apple Health)
CREATE TABLE IF NOT EXISTS public.health_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  source TEXT DEFAULT 'manual',
  sleep_duration_minutes INT,
  sleep_efficiency FLOAT,
  hrv_avg FLOAT,
  resting_hr INT,
  readiness_score INT,
  deep_sleep_minutes INT,
  rem_sleep_minutes INT,
  light_sleep_minutes INT,
  raw_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, date, source)
);
ALTER TABLE public.health_metrics ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own health metrics" ON public.health_metrics FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX idx_health_metrics_user_date ON public.health_metrics(user_id, date DESC);

-- MAVIS proactive insights
CREATE TABLE IF NOT EXISTS public.mavis_insights (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  severity TEXT DEFAULT 'info',
  source TEXT DEFAULT 'pattern_detection',
  read_at TIMESTAMPTZ,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.mavis_insights ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own insights" ON public.mavis_insights FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX idx_insights_user ON public.mavis_insights(user_id, generated_at DESC);

-- Calendar events
CREATE TABLE IF NOT EXISTS public.calendar_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_uid TEXT,
  title TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ,
  description TEXT DEFAULT '',
  location TEXT DEFAULT '',
  ical_url TEXT DEFAULT '',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, event_uid)
);
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own calendar events" ON public.calendar_events FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add scheduled_at to mavis_social_posts if not present
ALTER TABLE public.mavis_social_posts ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE public.mavis_social_posts ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'twitter';
