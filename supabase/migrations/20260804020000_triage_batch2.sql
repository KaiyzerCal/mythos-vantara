-- ============================================================
-- MISSING TABLE TRIAGE — batch 2 of N
-- Schemas derived from actual .insert()/.update()/.select() calls
-- across every referencing file, not guessed from table names.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.mavis_insights (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title         text NOT NULL,
  content       text NOT NULL,
  category      text NOT NULL,
  severity      text NOT NULL DEFAULT 'info',
  generated_at  timestamptz NOT NULL DEFAULT now(),
  read_at       timestamptz
);
ALTER TABLE public.mavis_insights ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own insights" ON public.mavis_insights FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE INDEX idx_mavis_insights_user_generated ON public.mavis_insights(user_id, generated_at DESC);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.mavis_leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name      text NOT NULL,
  contact_name      text,
  contact_title     text,
  contact_email     text,
  linkedin_url      text,
  research_summary  text,
  outreach_draft    text,
  status            text NOT NULL DEFAULT 'new',
  score             numeric,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mavis_leads ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own leads" ON public.mavis_leads FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.mavis_opportunities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title             text NOT NULL,
  description       text NOT NULL,
  opportunity_type  text NOT NULL,
  domains           jsonb NOT NULL DEFAULT '[]',
  potential_value   text,
  action_steps      jsonb NOT NULL DEFAULT '[]',
  confidence        numeric NOT NULL DEFAULT 0.7,
  acted_on          boolean NOT NULL DEFAULT false,
  expires_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mavis_opportunities ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own opportunities" ON public.mavis_opportunities FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE INDEX idx_mavis_opportunities_user_acted ON public.mavis_opportunities(user_id, acted_on);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.mavis_predictions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prediction_type   text NOT NULL,
  title             text NOT NULL,
  content           text NOT NULL,
  confidence        numeric NOT NULL DEFAULT 0.7,
  triggers          jsonb NOT NULL DEFAULT '[]',
  acted_on          boolean NOT NULL DEFAULT false,
  expires_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mavis_predictions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own predictions" ON public.mavis_predictions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE INDEX idx_mavis_predictions_user_acted ON public.mavis_predictions(user_id, acted_on);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.mavis_relationship_health (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id              uuid,
  contact_name            text NOT NULL,
  relationship_type       text NOT NULL DEFAULT 'professional',
  health_score            numeric NOT NULL DEFAULT 5,
  interaction_frequency   text,
  days_since_contact      integer NOT NULL DEFAULT 0,
  last_interaction_at     timestamptz,
  notes                   text,
  suggested_action        text,
  action_urgency          text NOT NULL DEFAULT 'low',
  alert_sent_at           timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, contact_name)
);
ALTER TABLE public.mavis_relationship_health ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own relationship health" ON public.mavis_relationship_health FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.mavis_sms_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_number     text NOT NULL,
  from_number   text,
  message       text NOT NULL,
  channel       text,
  status        text NOT NULL DEFAULT 'sent',
  twilio_sid    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mavis_sms_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users read own sms log" ON public.mavis_sms_log FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
