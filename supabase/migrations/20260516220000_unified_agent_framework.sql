-- ═══════════════════════════════════════════════════════════
-- VANTARA UNIFIED AGENT FRAMEWORK
-- Councils (inward) + Personas (outward) share a permission model.
-- ═══════════════════════════════════════════════════════════

-- ── Extend councils table ─────────────────────────────────
ALTER TABLE public.councils
  ADD COLUMN IF NOT EXISTS personality_prompt    text,
  ADD COLUMN IF NOT EXISTS can_be_summoned       boolean     DEFAULT true,
  ADD COLUMN IF NOT EXISTS telegram_enabled      boolean     DEFAULT true,
  ADD COLUMN IF NOT EXISTS voice_style           text,
  ADD COLUMN IF NOT EXISTS data_access_tier      text        DEFAULT 'full'
    CHECK (data_access_tier IN ('full', 'scoped', 'public'));

-- ── Extend personas table ─────────────────────────────────
ALTER TABLE public.personas
  ADD COLUMN IF NOT EXISTS data_access_tier      text        DEFAULT 'scoped'
    CHECK (data_access_tier IN ('full', 'scoped', 'public')),
  ADD COLUMN IF NOT EXISTS can_join_council      boolean     DEFAULT true,
  ADD COLUMN IF NOT EXISTS voice_style           text,
  ADD COLUMN IF NOT EXISTS telegram_enabled      boolean     DEFAULT true,
  ADD COLUMN IF NOT EXISTS content_niche         text;

-- ═══════════════════════════════════════════════════════════
-- AGENT TELEGRAM CONFIG
-- Keeps Telegram credentials separate from agent tables.
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.agent_telegram_config (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  agent_id    uuid  NOT NULL,
  agent_type  text  NOT NULL CHECK (agent_type IN ('council', 'persona')),
  bot_token   text,
  chat_id     text,
  webhook_url text,
  active      boolean DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (agent_id, agent_type)
);
ALTER TABLE public.agent_telegram_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users own telegram config"
    ON public.agent_telegram_config FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════
-- PERSONA REVENUE
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.persona_revenue (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  persona_id         uuid  NOT NULL,
  source             text  NOT NULL,
  amount             numeric(10,2) NOT NULL DEFAULT 0,
  currency           text  DEFAULT 'USD',
  description        text,
  content_id         uuid,
  stripe_payment_id  text,
  created_at         timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS persona_revenue_user_idx    ON public.persona_revenue(user_id);
CREATE INDEX IF NOT EXISTS persona_revenue_persona_idx ON public.persona_revenue(persona_id);
ALTER TABLE public.persona_revenue ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users own persona revenue"
    ON public.persona_revenue FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════
-- PERSONA CONTENT
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.persona_content (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  persona_id        uuid  NOT NULL,
  title             text  NOT NULL,
  body              text  NOT NULL,
  content_type      text  NOT NULL DEFAULT 'post'
    CHECK (content_type IN ('post','thread','article','script','pitch','email','caption')),
  platform          text,
  status            text  DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),
  engagement_score  int   DEFAULT 0,
  revenue_generated numeric(10,2) DEFAULT 0,
  published_at      timestamptz,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS persona_content_persona_idx ON public.persona_content(persona_id);
ALTER TABLE public.persona_content ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users own persona content"
    ON public.persona_content FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════
-- COUNCIL SESSIONS
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.council_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_type text DEFAULT 'council'
    CHECK (session_type IN ('council','persona','mixed','summoned')),
  participants jsonb DEFAULT '[]',
  messages     jsonb DEFAULT '[]',
  summary      text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
ALTER TABLE public.council_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users own council sessions"
    ON public.council_sessions FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
