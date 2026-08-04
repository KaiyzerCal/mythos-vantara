-- ============================================================
-- MISSING TABLE TRIAGE — batch 1 of N
-- Schemas derived from actual .insert()/.update()/.select() calls
-- across every referencing file, not guessed from table names.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.email_outbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_address   text NOT NULL,
  subject      text NOT NULL,
  body         text NOT NULL,
  resend_id    text,
  status       text NOT NULL DEFAULT 'sent',
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users read own email_outbox" ON public.email_outbox FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.mavis_api_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  key_hash        text NOT NULL,
  key_prefix      text NOT NULL,
  permissions     jsonb NOT NULL DEFAULT '[]',
  is_active       boolean NOT NULL DEFAULT true,
  last_used_at    timestamptz,
  requests_count  integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(key_hash)
);
ALTER TABLE public.mavis_api_keys ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own api keys" ON public.mavis_api_keys FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.mavis_autonomous_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal          text NOT NULL,
  status        text NOT NULL DEFAULT 'pending',
  plan          jsonb NOT NULL DEFAULT '[]',
  current_step  integer NOT NULL DEFAULT 0,
  context       jsonb NOT NULL DEFAULT '{}',
  result        jsonb,
  error         text,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mavis_autonomous_tasks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own autonomous tasks" ON public.mavis_autonomous_tasks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE INDEX idx_mavis_autonomous_tasks_status ON public.mavis_autonomous_tasks(status, updated_at);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.mavis_competitors (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                text NOT NULL,
  url                 text NOT NULL,
  notes               text,
  changes_detected    integer NOT NULL DEFAULT 0,
  last_content_hash   text,
  last_checked_at     timestamptz,
  snapshot            jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mavis_competitors ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own competitors" ON public.mavis_competitors FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.mavis_device_sessions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_name           text NOT NULL,
  device_fingerprint    text NOT NULL,
  platform              text,
  user_agent            text,
  status                text NOT NULL DEFAULT 'pending',
  last_seen_at          timestamptz,
  approved_at           timestamptz,
  revoked_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, device_fingerprint)
);
ALTER TABLE public.mavis_device_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own device sessions" ON public.mavis_device_sessions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.mavis_entities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name             text NOT NULL,
  entity_type      text NOT NULL,
  description      text,
  aliases          jsonb NOT NULL DEFAULT '[]',
  mention_count    integer NOT NULL DEFAULT 1,
  last_mentioned   timestamptz NOT NULL DEFAULT now(),
  embedding        vector(384),
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mavis_entities ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users manage own entities" ON public.mavis_entities FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE INDEX idx_mavis_entities_user_mentions ON public.mavis_entities(user_id, mention_count DESC);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
