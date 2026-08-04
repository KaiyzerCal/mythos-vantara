-- ============================================================
-- FIX 4 SILENTLY BROKEN FEATURES — tables referenced by real,
-- executed code that never actually existed live
-- ============================================================
-- Found via a systematic diff: every .from("table") call across src/
-- and supabase/functions against the live schema turned up 103
-- candidates. These 3 are confirmed real, active, high-value gaps
-- (achievements page + edge function, MAVIS's own device push system,
-- the generic incoming webhook receiver) — not aspirational/unused
-- scaffolding like most of the other 100.
--
-- The 4th ("oauth_tokens") isn't a missing table at all — it's a typo.
-- mavis_oauth_tokens already exists (20260621000003_salesforce_booking.sql)
-- and Salesforce/persona-social integrations already use it correctly.
-- SpotifyWidget.tsx alone queries the bare, nonexistent "oauth_tokens" —
-- fixed in the same commit as this migration, not here (it's a code
-- change, not a schema one).
-- ============================================================

-- ── achievements ──────────────────────────────────────────────
-- Written only by mavis-achievement-check (service role) after it
-- verifies the unlock condition server-side — no client insert path
-- exists or should exist, since each unlock also awards real XP.
CREATE TABLE IF NOT EXISTS public.achievements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_key  text NOT NULL,
  title            text NOT NULL,
  description      text NOT NULL,
  icon             text NOT NULL,
  category         text NOT NULL,
  unlocked_at      timestamptz NOT NULL DEFAULT now(),
  data             jsonb NOT NULL DEFAULT '{}',
  UNIQUE(user_id, achievement_key)
);

ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "users read own achievements" ON public.achievements
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_achievements_user ON public.achievements(user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── device_push_tokens ────────────────────────────────────────
-- Client-writable (the device registers its own token via upsert),
-- service-role-writable (mavis-push-notify marks tokens inactive on
-- send failure / bumps last_used_at on success).
CREATE TABLE IF NOT EXISTS public.device_push_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token          text NOT NULL,
  platform       text NOT NULL,
  device_name    text,
  active         boolean NOT NULL DEFAULT true,
  error_count    integer NOT NULL DEFAULT 0,
  last_used_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, token)
);

ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "users manage own push tokens" ON public.device_push_tokens
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_device_push_tokens_user_active ON public.device_push_tokens(user_id) WHERE active = true;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── webhook_events ─────────────────────────────────────────────
-- Written and read only by mavis-webhook (service role) — no
-- frontend references this table, so no self-service RLS policy is
-- needed; RLS enabled with zero policies denies anon/authenticated by
-- default while service_role bypasses it as usual.
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type        text NOT NULL,
  source            text NOT NULL,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data              jsonb NOT NULL DEFAULT '{}',
  actions_executed  jsonb NOT NULL DEFAULT '[]',
  verified          boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE INDEX idx_webhook_events_user ON public.webhook_events(user_id, created_at DESC);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
