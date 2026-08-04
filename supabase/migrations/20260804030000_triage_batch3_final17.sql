-- ============================================================
-- MISSING TABLE TRIAGE — batch 3 (final): the 17 tables with no
-- pre-existing authored migration anywhere in git history.
-- Schemas derived from actual .select()/.insert()/.upsert() calls
-- across every referencing file. Several of these (task_completions,
-- finance_entries, generated_websites, gumroad_sales, stripe_revenue,
-- mavis_journal, mavis_meetings, mavis_vault_entries, strava_activities)
-- have NO insert/write call anywhere in the codebase — they are
-- read-only dead ends today (same class of issue already flagged for
-- social_post_analytics). Tables are still created so the reads stop
-- 404ing; granted full CRUD to the owner for forward-compatibility,
-- consistent with every other table in this triage.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.task_completions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id      uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.task_completions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own task completions" ON public.task_completions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_task_completions_task ON public.task_completions(task_id, completed_at DESC);

CREATE TABLE IF NOT EXISTS public.finance_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount      numeric NOT NULL,
  type        text NOT NULL DEFAULT 'expense',
  category    text,
  description text,
  date        date NOT NULL DEFAULT CURRENT_DATE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.finance_entries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own finance entries" ON public.finance_entries FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_finance_entries_user_date ON public.finance_entries(user_id, date DESC);

CREATE TABLE IF NOT EXISTS public.generated_websites (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text,
  url        text,
  status     text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.generated_websites ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own generated websites" ON public.generated_websites FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.gumroad_sales (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_name text,
  sale_id      text,
  price        numeric NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gumroad_sales ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own gumroad sales" ON public.gumroad_sales FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.stripe_revenue (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount     numeric NOT NULL DEFAULT 0,
  source     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stripe_revenue ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own stripe revenue" ON public.stripe_revenue FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.mavis_activity_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type  text NOT NULL,
  description text,
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mavis_activity_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own activity log" ON public.mavis_activity_log FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_mavis_activity_log_user_created ON public.mavis_activity_log(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mavis_approvals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id    text,
  action_type text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'pending',
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
ALTER TABLE public.mavis_approvals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own approvals" ON public.mavis_approvals FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.mavis_council_discourse (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic        text NOT NULL,
  participants jsonb NOT NULL DEFAULT '[]',
  rounds       jsonb NOT NULL DEFAULT '[]',
  synthesis    text,
  status       text NOT NULL DEFAULT 'complete',
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mavis_council_discourse ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own council discourse" ON public.mavis_council_discourse FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.mavis_instagram_trends (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_code         text NOT NULL,
  hashtag              text,
  original_caption     text,
  thumbnail_url        text,
  is_posted            boolean NOT NULL DEFAULT false,
  generated_caption    text,
  generated_image_url  text,
  instagram_post_id    text,
  posted_at            timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, content_code)
);
ALTER TABLE public.mavis_instagram_trends ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own instagram trends" ON public.mavis_instagram_trends FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.mavis_journal (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      text NOT NULL,
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mavis_journal ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own journal" ON public.mavis_journal FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_mavis_journal_user_created ON public.mavis_journal(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mavis_meetings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      text NOT NULL,
  summary    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mavis_meetings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own meetings" ON public.mavis_meetings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.mavis_standing_orders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_text  text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, order_text)
);
ALTER TABLE public.mavis_standing_orders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own standing orders" ON public.mavis_standing_orders FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.mavis_time_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title             text NOT NULL,
  category          text,
  duration_minutes  int,
  start_time        timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mavis_time_entries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own time entries" ON public.mavis_time_entries FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_mavis_time_entries_user_start ON public.mavis_time_entries(user_id, start_time DESC);

CREATE TABLE IF NOT EXISTS public.mavis_user_profile (
  user_id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_md          text NOT NULL DEFAULT '',
  communication_style text NOT NULL DEFAULT '',
  key_context         text NOT NULL DEFAULT '',
  preferences         jsonb NOT NULL DEFAULT '{}',
  topics_of_interest  text[] NOT NULL DEFAULT '{}',
  updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mavis_user_profile ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own profile" ON public.mavis_user_profile FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.mavis_vault_entries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      text NOT NULL,
  content    text NOT NULL,
  tags       text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mavis_vault_entries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own vault entries" ON public.mavis_vault_entries FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_mavis_vault_entries_user_created ON public.mavis_vault_entries(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.strava_activities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text,
  sport_type   text,
  distance     numeric,
  moving_time  int,
  start_date   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.strava_activities ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own strava activities" ON public.strava_activities FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_strava_activities_user_date ON public.strava_activities(user_id, start_date DESC);

-- prymal_onboarding_tokens: client-scoped, service-role only (no client-side
-- .from() call anywhere — only prymal-onboard edge function, using service role).
-- RLS enabled with no policies = deny-all except service_role, matching the
-- other 9 prymal_* tables hardened in the fixups migration.
CREATE TABLE IF NOT EXISTS public.prymal_onboarding_tokens (
  client_id  uuid PRIMARY KEY REFERENCES public.prymal_clients(id) ON DELETE CASCADE,
  token      text NOT NULL UNIQUE,
  email      text,
  used       boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.prymal_onboarding_tokens ENABLE ROW LEVEL SECURITY;
