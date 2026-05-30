-- ================================================================
-- apply-pending-migrations.sql  (ALL pending — May 17 onwards)
-- Safe to run multiple times. Paste into Supabase SQL Editor → Run
-- ================================================================


-- ======== 20260517120000_mavis_crons_r4.sql ========
-- MAVIS Round-4 Cron Schedules
-- Adds pg_cron entries for all periodic MAVIS functions that weren't already scheduled.
-- Requires pg_cron and pg_net extensions enabled in Supabase Dashboard.
--
-- Uses current_setting('app.supabase_url') and current_setting('app.service_role_key')
-- which must be set via: ALTER DATABASE postgres SET app.supabase_url = '...';
--                         ALTER DATABASE postgres SET app.service_role_key = '...';
-- (Do this once in the Supabase SQL editor.)

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Morning brief — 06:00 UTC daily
--    Pushes the structured daily brief to Telegram with pattern alerts + operator prefs.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'mavis-morning-brief',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-morning-brief',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Nightly memory consolidation — 02:00 UTC daily
--    Reads unconsolidated mavis_memory, extracts knowledge + tacit, marks consolidated.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'mavis-consolidate',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-consolidate',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Spaced repetition check — 05:30 UTC daily
--    Surfaces notes due for review and sends reminders.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'mavis-spaced-repetition',
  '30 5 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-spaced-repetition',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Streak alerts — 08:00 UTC daily
--    Checks habit streaks and sends Telegram warnings before streaks break.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'mavis-streak-alerts',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-streak-alerts',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Periodic review — 03:00 UTC every Sunday
--    Weekly system review: goal progress, stalled quests, energy trends.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'mavis-periodic-review',
  '0 3 * * 0',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-periodic-review',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Self-reflection synthesis — 03:30 UTC every Sunday
--    Groups raw corrections, synthesizes durable rules, upserts to mavis_tacit.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'mavis-self-reflect',
  '30 3 * * 0',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-self-reflect',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify: SELECT jobname, schedule FROM cron.job ORDER BY jobname;
-- ─────────────────────────────────────────────────────────────────────────────



-- ======== 20260517200000_new_features.sql ========
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
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
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
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
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
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
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
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add scheduled_at to mavis_social_posts if not present
ALTER TABLE public.mavis_social_posts ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE public.mavis_social_posts ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'twitter';



-- ======== 20260517210000_mavis_crons_r5.sql ========
-- MAVIS Round-5 Cron Schedules
-- Adds pg_cron entries for mavis-pattern-insights (weekly) and mavis-social-scheduler (hourly).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Pattern insights — 04:00 UTC every Monday
--    Runs behavioral analysis for all users, upserts to mavis_insights.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'mavis-pattern-insights',
  '0 4 * * 1',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-pattern-insights',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Social scheduler — every hour
--    Publishes scheduled/queued posts in mavis_social_posts via Nora.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'mavis-social-scheduler',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-social-scheduler',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Verify: SELECT jobname, schedule FROM cron.job ORDER BY jobname;



-- ======== 20260517220000_mavis_advanced.sql ========
-- MAVIS Advanced Features Migration
-- webhook_events table + vault_media extraction tracking

-- Webhook events log
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL,
  source TEXT DEFAULT 'unknown',
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  data JSONB DEFAULT '{}',
  actions_executed JSONB DEFAULT '[]',
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Service role only, no RLS needed (internal table)
CREATE INDEX idx_webhook_events_user ON public.webhook_events(user_id, created_at DESC);
CREATE INDEX idx_webhook_events_type ON public.webhook_events(event_type, created_at DESC);

-- Add extraction tracking to vault_media
ALTER TABLE public.vault_media ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ;
ALTER TABLE public.vault_media ADD COLUMN IF NOT EXISTS extraction_error TEXT;



-- ======== 20260517230000_mavis_research_meeting.sql ========
-- meeting_notes table
CREATE TABLE IF NOT EXISTS meeting_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  meeting_date DATE,
  attendees TEXT[] DEFAULT '{}',
  decisions TEXT[] DEFAULT '{}',
  action_items JSONB DEFAULT '[]',
  key_points TEXT[] DEFAULT '{}',
  summary TEXT,
  raw_transcript TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE meeting_notes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users own meeting_notes" ON meeting_notes FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_meeting_notes_user_date ON meeting_notes(user_id, created_at DESC);

-- time_logs table
CREATE TABLE IF NOT EXISTS time_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  task_id UUID REFERENCES mavis_tasks(id) ON DELETE SET NULL,
  project TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE time_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users own time_logs" ON time_logs FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_time_logs_user_date ON time_logs(user_id, started_at DESC);



-- ======== 20260517240000_nora_engagement.sql ========
-- nora_engagement_log: tracks every mention/DM Nora has seen and replied to.
-- No RLS — service role only (cron-driven, no user context).
CREATE TABLE IF NOT EXISTS nora_engagement_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type              TEXT NOT NULL CHECK (type IN ('mention', 'dm')),
  source_id         TEXT NOT NULL UNIQUE,    -- tweet ID or DM event ID
  source_author_id  TEXT,                   -- Twitter user ID of the sender
  source_text       TEXT,                   -- original tweet/DM text
  reply_text        TEXT,                   -- generated reply
  reply_id          TEXT,                   -- tweet ID or DM event ID of our reply
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('replied', 'failed', 'skipped', 'pending')),
  error             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nora_engagement_type_date
  ON nora_engagement_log(type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nora_engagement_source_id
  ON nora_engagement_log(source_id);

-- Cron: run mavis-nora-engage every 15 minutes
SELECT cron.schedule(
  'mavis-nora-engage',
  '*/15 * * * *',
  $$
    SELECT net.http_post(
      url      := current_setting('app.supabase_url') || '/functions/v1/mavis-nora-engage',
      headers  := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body     := '{}'::jsonb
    );
  $$
);



-- ======== 20260517250000_integrations.sql ========
-- =============================================================================
-- 20260517250000_integrations.sql
-- Integration tables: outbound webhook infrastructure, social analytics,
-- and email outbox.
-- =============================================================================

-- Outbound webhook configuration
CREATE TABLE IF NOT EXISTS webhook_dispatch_config (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  event_types  TEXT[] NOT NULL DEFAULT '{*}',
  secret       TEXT,
  active       BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE webhook_dispatch_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users own webhook_dispatch_config"
    ON webhook_dispatch_config FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Outbound webhook dispatch log
CREATE TABLE IF NOT EXISTS webhook_dispatch_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id   UUID REFERENCES webhook_dispatch_config(id) ON DELETE SET NULL,
  user_id     UUID,
  event_type  TEXT,
  payload     JSONB,
  status_code INT,
  ok          BOOLEAN DEFAULT false,
  error       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_dispatch_log_user
  ON webhook_dispatch_log(user_id, created_at DESC);

-- Social post analytics (stores fetched engagement metrics)
CREATE TABLE IF NOT EXISTS social_post_analytics (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id          UUID REFERENCES mavis_social_posts(id) ON DELETE SET NULL,
  platform         TEXT NOT NULL,
  external_post_id TEXT,
  impressions      INT DEFAULT 0,
  likes            INT DEFAULT 0,
  replies_count    INT DEFAULT 0,
  reposts          INT DEFAULT 0,
  profile_clicks   INT DEFAULT 0,
  fetched_at       TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE social_post_analytics ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users own social_post_analytics"
    ON social_post_analytics FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Email outbox
CREATE TABLE IF NOT EXISTS email_outbox (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_address  TEXT NOT NULL,
  subject     TEXT,
  body        TEXT,
  resend_id   TEXT,
  status      TEXT DEFAULT 'sent',
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users own email_outbox"
    ON email_outbox FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add external_post_id to mavis_social_posts for analytics linking
ALTER TABLE mavis_social_posts ADD COLUMN IF NOT EXISTS external_post_id TEXT;



-- ======== 20260517260000_push_notifications.sql ========
-- device push tokens for mobile/web push notifications
CREATE TABLE IF NOT EXISTS device_push_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token        TEXT NOT NULL,
  platform     TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  device_name  TEXT,
  active       BOOLEAN NOT NULL DEFAULT true,
  error_count  INT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, token)
);

ALTER TABLE device_push_tokens ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own tokens" ON device_push_tokens
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_device_push_tokens_user
  ON device_push_tokens(user_id) WHERE active = true;

-- Cron: mid-day nudge at noon UTC daily
SELECT cron.schedule(
  'mavis-proactive-nudge',
  '0 12 * * *',
  $$
    SELECT net.http_post(
      url     := current_setting('app.supabase_url') || '/functions/v1/mavis-proactive-nudge',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body    := '{}'::jsonb
    );
  $$
);



-- ======== 20260517270000_instagram_tiktok.sql ========
-- =============================================================================
-- 20260517270000_instagram_tiktok.sql
-- Add instagram and tiktok to the allowed platforms in mavis_social_posts.
-- Uses a DO block so it is safe to run on schemas that already have the
-- constraint (drops and recreates) as well as schemas where it was never added.
-- =============================================================================

DO $$
BEGIN
  -- Drop old check constraint if it exists and doesn't include new platforms
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mavis_social_posts_platform_check'
  ) THEN
    ALTER TABLE mavis_social_posts DROP CONSTRAINT mavis_social_posts_platform_check;
    ALTER TABLE mavis_social_posts ADD CONSTRAINT mavis_social_posts_platform_check
      CHECK (platform IN ('twitter', 'linkedin', 'instagram', 'tiktok', 'discord', 'facebook', 'other'));
  END IF;
END $$;



-- ======== 20260517280000_user_integrations.sql ========
-- Stores user-provided API keys and integration configs
-- Keys are stored as-is (server-side RLS protects them; advise users to use scoped keys)
CREATE TABLE IF NOT EXISTS mavis_user_integrations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,   -- 'openai', 'anthropic', 'twitter', 'linkedin', 'discord', 'instagram', 'tiktok', 'resend', 'telegram', 'oura', 'stripe', 'gumroad', 'fcm'
  key_name     TEXT NOT NULL,   -- human label e.g. 'API Key', 'Access Token'
  key_value    TEXT NOT NULL,
  verified     BOOLEAN NOT NULL DEFAULT false,
  last_tested  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, provider, key_name)
);

ALTER TABLE mavis_user_integrations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own integrations" ON mavis_user_integrations
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_mavis_user_integrations_user
  ON mavis_user_integrations(user_id, provider);



-- ======== 20260517290000_weekly_retro.sql ========
-- Cron: weekly retrospective every Sunday at 18:00 UTC
SELECT cron.schedule(
  'mavis-weekly-retro',
  '0 18 * * 0',
  $$
    SELECT net.http_post(
      url     := current_setting('app.supabase_url') || '/functions/v1/mavis-weekly-retro',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- Also add mood column to journal_entries if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'journal_entries' AND column_name = 'mood'
  ) THEN
    ALTER TABLE journal_entries ADD COLUMN mood TEXT;
  END IF;
END $$;

-- Add tags column to journal_entries if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'journal_entries' AND column_name = 'tags'
  ) THEN
    ALTER TABLE journal_entries ADD COLUMN tags TEXT[] DEFAULT '{}';
  END IF;
END $$;



-- ======== 20260518010000_crm_achievements_slack.sql ========
-- Achievements / badge system
CREATE TABLE IF NOT EXISTS achievements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_key TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  icon         TEXT DEFAULT '🏆',
  category     TEXT NOT NULL DEFAULT 'general'
                 CHECK (category IN ('quests','habits','finance','social','knowledge','bond','special')),
  unlocked_at  TIMESTAMPTZ DEFAULT now(),
  data         JSONB DEFAULT '{}'::jsonb,
  UNIQUE(user_id, achievement_key)
);
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users see own achievements" ON achievements FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CRM follow-up config columns on contacts (add if missing)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contacts' AND column_name='follow_up_days') THEN
    ALTER TABLE contacts ADD COLUMN follow_up_days INT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contacts' AND column_name='birthday') THEN
    ALTER TABLE contacts ADD COLUMN birthday DATE;
  END IF;
END $$;

-- Slack config
CREATE TABLE IF NOT EXISTS mavis_slack_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  workspace_name  TEXT,
  bot_user_id     TEXT,
  default_channel TEXT,
  active          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE mavis_slack_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own slack config" ON mavis_slack_config FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Cron: auto-journal at 21:00 UTC daily
SELECT cron.schedule('mavis-auto-journal', '0 21 * * *', $$
  SELECT net.http_post(url := current_setting('app.supabase_url') || '/functions/v1/mavis-auto-journal',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body := '{}'::jsonb);
$$);

-- Cron: CRM nudge at 09:00 UTC daily
SELECT cron.schedule('mavis-crm-nudge', '0 9 * * *', $$
  SELECT net.http_post(url := current_setting('app.supabase_url') || '/functions/v1/mavis-crm-nudge',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body := '{}'::jsonb);
$$);

-- Cron: sleep coaching at 07:00 UTC daily (after morning brief)
SELECT cron.schedule('mavis-sleep-coach', '0 7 * * *', $$
  SELECT net.http_post(url := current_setting('app.supabase_url') || '/functions/v1/mavis-sleep-coach',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body := '{}'::jsonb);
$$);



-- ======== 20260518020000_import_ab.sql ========
-- Import jobs tracker
CREATE TABLE IF NOT EXISTS mavis_import_jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source      TEXT NOT NULL CHECK (source IN ('notion','obsidian','markdown','readwise','csv')),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  total       INT DEFAULT 0,
  imported    INT DEFAULT 0,
  skipped     INT DEFAULT 0,
  error       TEXT,
  started_at  TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ
);
ALTER TABLE mavis_import_jobs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users see own imports" ON mavis_import_jobs FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A/B testing for social posts
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mavis_social_posts' AND column_name='ab_group') THEN
    ALTER TABLE mavis_social_posts ADD COLUMN ab_group TEXT CHECK (ab_group IN ('A','B'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mavis_social_posts' AND column_name='ab_test_id') THEN
    ALTER TABLE mavis_social_posts ADD COLUMN ab_test_id UUID;
  END IF;
END $$;

-- Google Calendar integration key via mavis_user_integrations (no schema change needed,
-- just document that provider='google_calendar', key_name in ('access_token','calendar_id'))

-- Cron: achievement check after key events (called programmatically, no cron needed)
-- Cron: quest-to-calendar sync daily at 08:00 UTC
SELECT cron.schedule('mavis-quest-calendar', '0 8 * * *', $$
  SELECT net.http_post(url := current_setting('app.supabase_url') || '/functions/v1/mavis-quest-calendar',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body := '{"action":"push"}'::jsonb);
$$);



-- ======== 20260518030000_language_sw.sql ========
-- Language preference
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='language') THEN
    ALTER TABLE profiles ADD COLUMN language TEXT DEFAULT 'en';
  END IF;
END $$;



-- ======== 20260518040000_oura_strava_github.sql ========
-- health_metrics table (if not exists)
CREATE TABLE IF NOT EXISTS health_metrics (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  metric_date date NOT NULL,
  metric_type text NOT NULL,
  value numeric,
  unit text,
  source text DEFAULT 'manual',
  raw_data jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, metric_date, metric_type, source)
);
ALTER TABLE health_metrics ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='health_metrics' AND policyname='health_metrics_owner') THEN
    CREATE POLICY health_metrics_owner ON health_metrics FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- pg_cron jobs for daily sync (08:30 UTC)
SELECT cron.schedule('mavis-oura-daily', '30 8 * * *',
  $$SELECT net.http_post(url := current_setting('app.supabase_url') || '/functions/v1/mavis-oura-sync',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'), 'Content-Type', 'application/json'),
    body := '{}'::jsonb) AS request_id$$);

SELECT cron.schedule('mavis-strava-daily', '35 8 * * *',
  $$SELECT net.http_post(url := current_setting('app.supabase_url') || '/functions/v1/mavis-strava-sync',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'), 'Content-Type', 'application/json'),
    body := '{}'::jsonb) AS request_id$$);

SELECT cron.schedule('mavis-github-hourly', '0 * * * *',
  $$SELECT net.http_post(url := current_setting('app.supabase_url') || '/functions/v1/mavis-github-sync',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'), 'Content-Type', 'application/json'),
    body := '{}'::jsonb) AS request_id$$);



-- ======== 20260518050000_morning_digest.sql ========
-- Morning digest logs
CREATE TABLE IF NOT EXISTS morning_digest_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  digest_date date NOT NULL DEFAULT CURRENT_DATE,
  content text,
  quality_score numeric,
  delivery_method text DEFAULT 'telegram',
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, digest_date)
);
ALTER TABLE morning_digest_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='morning_digest_logs' AND policyname='digest_owner') THEN
    CREATE POLICY digest_owner ON morning_digest_logs FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- pg_cron: 07:00 UTC daily
SELECT cron.schedule('mavis-morning-digest', '0 7 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/mavis-morning-digest',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb
  ) AS request_id$$);



-- ======== 20260518060000_weather_rss.sql ========
-- RSS feeds table
CREATE TABLE IF NOT EXISTS rss_feeds (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  url text NOT NULL,
  is_active boolean DEFAULT true,
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, url)
);
ALTER TABLE rss_feeds ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='rss_feeds' AND policyname='rss_feeds_owner') THEN
    CREATE POLICY rss_feeds_owner ON rss_feeds FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- pg_cron: HN digest at 08:00 UTC daily
SELECT cron.schedule('mavis-hn-daily', '0 8 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/mavis-hn-digest',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb
  ) AS request_id$$);



-- ======== 20260518070000_google_sync.sql ========
-- Add external_id column to tasks for Google Tasks bidirectional sync
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source text;
CREATE INDEX IF NOT EXISTS tasks_external_id_idx ON tasks(user_id, external_id) WHERE external_id IS NOT NULL;

-- pg_cron: Google Tasks sync at 09:00 UTC daily
SELECT cron.schedule('mavis-google-tasks-sync', '0 9 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/mavis-google-tasks-sync',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{"direction":"sync"}'::jsonb
  ) AS request_id$$);

-- pg_cron: GDrive sync at 06:00 UTC daily
SELECT cron.schedule('mavis-gdrive-sync', '0 6 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/mavis-gdrive-sync',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb
  ) AS request_id$$);



-- ======== 20260518080000_workflows.sql ========
CREATE TABLE IF NOT EXISTS workflows (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  description text DEFAULT '',
  trigger_type text DEFAULT 'manual',
  trigger_config jsonb DEFAULT '{}',
  steps jsonb DEFAULT '[]',
  is_active boolean DEFAULT true,
  last_run_at timestamptz,
  last_run_status text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='workflows' AND policyname='workflows_owner') THEN
    CREATE POLICY workflows_owner ON workflows FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS workflow_runs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_id uuid REFERENCES workflows(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status text DEFAULT 'running',
  steps_log jsonb DEFAULT '[]',
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='workflow_runs' AND policyname='workflow_runs_owner') THEN
    CREATE POLICY workflow_runs_owner ON workflow_runs FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;



-- ======== 20260518090000_telegram_linked_accounts.sql ========
-- Allow multiple Telegram accounts to talk to the same MAVIS operator.
-- Each row maps a secondary Telegram user ID to the operator's Supabase user.
-- The telegram-webhook edge function queries this table when the incoming
-- sender does not match the primary TELEGRAM_OPERATOR_CHAT_ID env var.

CREATE TABLE IF NOT EXISTS public.telegram_linked_accounts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_user_id text        NOT NULL,
  label            text        NOT NULL DEFAULT 'Linked Account',
  created_at       timestamptz DEFAULT now(),
  UNIQUE (user_id, telegram_user_id)
);

ALTER TABLE public.telegram_linked_accounts ENABLE ROW LEVEL SECURITY;

-- Users can only manage their own linked accounts
DO $$ BEGIN
  CREATE POLICY "Users manage own linked telegram accounts"
    ON public.telegram_linked_accounts
    FOR ALL
    USING  (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Index for fast lookup by telegram_user_id (used by edge function)
CREATE INDEX IF NOT EXISTS idx_telegram_linked_accounts_tg_user
  ON public.telegram_linked_accounts(telegram_user_id);



-- ======== 20260518100000_plugin_system.sql ========
-- Plugin System, Inter-Agent A2A Bus, and Agent Memory Engine
-- Adapts ElizaOS plugin registry, Moltbook message envelope, and
-- Obsidian-style persistent memory to the existing MAVIS DB schema.

-- ── Plugin registry ───────────────────────────────────────────
-- Stores installed plugins with their manifests, capability declarations,
-- and enable/disable state. Mirrors ElizaOS Character plugin array
-- but persisted in DB so they survive deploys.
CREATE TABLE IF NOT EXISTS public.mavis_plugins (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  version         text        NOT NULL DEFAULT '0.1.0',
  description     text        NOT NULL,
  author          text,
  manifest        jsonb       NOT NULL DEFAULT '{}',  -- Full plugin manifest JSON
  capabilities    text[]      DEFAULT '{}',           -- e.g. ["inference","tool","analysis"]
  required_scopes text[]      DEFAULT '{}',           -- data access scopes needed
  enabled         boolean     NOT NULL DEFAULT true,
  config          jsonb       DEFAULT '{}',           -- User-supplied config (API keys, etc.)
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (user_id, name)
);

ALTER TABLE public.mavis_plugins ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own plugins"
    ON public.mavis_plugins FOR ALL
    USING  (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── A2A inter-agent message bus ───────────────────────────────
-- Moltbook-style message envelope for agent-to-agent communication.
-- Agents poll this table via their AgentInbox or subscribe via Realtime.
-- Uses Moltbook's intent vocabulary + A2A Protocol v0.3 envelope fields.
CREATE TABLE IF NOT EXISTS public.mavis_agent_messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Sender (Moltbook sender object)
  from_agent_id   text        NOT NULL,   -- council/{id}, persona/{id}, plugin/{name}, mavis
  from_agent_name text        NOT NULL,
  from_agent_type text        NOT NULL,   -- council | persona | plugin | mavis
  from_karma      int         DEFAULT 0,  -- Moltbook reputation score

  -- Recipient
  to_agent_id     text        NOT NULL,   -- same format as from_agent_id
  to_agent_name   text,

  -- Payload (Moltbook + A2A Protocol)
  intent          text        NOT NULL CHECK (intent IN ('REQUEST','RESPONSE','BROADCAST','HEARTBEAT','SIGNAL','VOTE','DELEGATE')),
  content         text        NOT NULL,
  payload         jsonb       DEFAULT '{}',          -- Structured data beyond text
  correlation_id  uuid,                              -- Links request → response pairs
  priority        text        DEFAULT 'normal' CHECK (priority IN ('critical','high','normal','background')),
  ttl_ms          int         DEFAULT 300000,         -- 5 min default TTL

  -- Delivery tracking
  delivered       boolean     DEFAULT false,
  read            boolean     DEFAULT false,
  ack             boolean     DEFAULT false,

  created_at      timestamptz DEFAULT now(),
  expires_at      timestamptz GENERATED ALWAYS AS (created_at + (ttl_ms || ' milliseconds')::interval) STORED
);

ALTER TABLE public.mavis_agent_messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own agent messages"
    ON public.mavis_agent_messages FOR ALL
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_messages_to_agent
  ON public.mavis_agent_messages(to_agent_id, delivered, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_messages_correlation
  ON public.mavis_agent_messages(correlation_id) WHERE correlation_id IS NOT NULL;

-- ── Unified agent memory (Obsidian-pattern) ───────────────────
-- One memory record per "experience", "fact", "pattern", "relationship", or "decision".
-- Frontmatter fields mirror obsidian-mind's schema.
-- Supplements (not replaces) mavis_council_memory and persona_memories.
-- All agent types write here; semantic search via existing pgvector extension.
CREATE TABLE IF NOT EXISTS public.mavis_agent_memories (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Obsidian-style identity fields (frontmatter equivalents)
  agent_id        text        NOT NULL,   -- council/{id} | persona/{id} | plugin/{name} | mavis
  agent_name      text        NOT NULL,
  agent_type      text        NOT NULL CHECK (agent_type IN ('council','persona','plugin','mavis')),

  entity_type     text        NOT NULL CHECK (entity_type IN ('experience','fact','pattern','relationship','decision','signal')),
  memory_type     text        NOT NULL CHECK (memory_type IN ('episodic','semantic','procedural','working')),
  content         text        NOT NULL,
  summary         text,                  -- Compressed version for prompt injection
  tags            text[]      DEFAULT '{}',
  wikilinks       text[]      DEFAULT '{}',  -- [[entity]] references (Obsidian-style links)
  importance      int         DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  confidence      int         DEFAULT 7 CHECK (confidence BETWEEN 1 AND 10),

  -- Source tracing
  source_session  text,                  -- mavis_memory session_id that generated this
  source_date     date        DEFAULT CURRENT_DATE,

  -- Spaced repetition (obsidian-mind pattern)
  next_review_at  timestamptz,
  review_count    int         DEFAULT 0,
  ease_factor     float       DEFAULT 2.5,  -- SM-2 algorithm ease

  -- Vector embedding for semantic recall
  embedding       vector(1536),

  -- Status
  status          text        DEFAULT 'active' CHECK (status IN ('active','archived','superseded')),
  superseded_by   uuid        REFERENCES public.mavis_agent_memories(id),

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.mavis_agent_memories ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own agent memories"
    ON public.mavis_agent_memories FOR ALL
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_memories_agent
  ON public.mavis_agent_memories(agent_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_memories_type
  ON public.mavis_agent_memories(agent_type, entity_type, importance DESC);

-- Semantic recall function (mirrors match_council_memory)
CREATE OR REPLACE FUNCTION match_agent_memory(
  query_embedding  vector(1536),
  match_agent_id   text,
  match_threshold  float   DEFAULT 0.40,
  match_count      int     DEFAULT 8
)
RETURNS TABLE (
  id          uuid,
  content     text,
  summary     text,
  entity_type text,
  memory_type text,
  tags        text[],
  importance  int,
  created_at  timestamptz,
  similarity  float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id, content, summary, entity_type, memory_type, tags, importance, created_at,
    1 - (embedding <=> query_embedding) AS similarity
  FROM public.mavis_agent_memories
  WHERE agent_id = match_agent_id
    AND status = 'active'
    AND embedding IS NOT NULL
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
$$;

-- ── Agent karma/reputation (Moltbook MolTrust pattern) ────────
-- Tracks agent contribution quality scores for message priority routing.
CREATE TABLE IF NOT EXISTS public.mavis_agent_karma (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id    text NOT NULL,
  agent_name  text NOT NULL,
  karma       int  NOT NULL DEFAULT 0,
  signals     int  NOT NULL DEFAULT 0,  -- Number of SIGNAL messages sent
  responses   int  NOT NULL DEFAULT 0,  -- Responses sent
  accuracy    float DEFAULT 0.5,        -- Accuracy of predictions/recommendations
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, agent_id)
);

ALTER TABLE public.mavis_agent_karma ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own agent karma"
    ON public.mavis_agent_karma FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Plugin execution log ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mavis_plugin_executions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plugin_name   text        NOT NULL,
  action_name   text        NOT NULL,
  input         text,
  output        text,
  success       boolean     NOT NULL DEFAULT true,
  error_msg     text,
  duration_ms   int,
  tokens_used   int,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.mavis_plugin_executions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users view own plugin executions"
    ON public.mavis_plugin_executions FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_plugin_executions_plugin
  ON public.mavis_plugin_executions(plugin_name, created_at DESC);



-- ======== 20260519000000_tool_registry_automation.sql ========
-- Tool Registry, Automation Rules, Ephemeral Agent Sessions, Distillation Jobs
-- Supports: OpenClaw tool orchestration, OpenJarvis event-driven automation,
-- ElizaOS dynamic agent formation, Felix AI knowledge compression.

-- ── Dynamic Tool Registry (OpenClaw pattern) ──────────────────────────────────
-- Stores registered tools with JSON Schema parameters for LLM function calling.
-- Built-in tools are registered in-memory; user-defined tools persist here.
CREATE TABLE IF NOT EXISTS public.mavis_tool_registry (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text        NOT NULL,
  category        text        NOT NULL DEFAULT 'general'
                              CHECK (category IN ('api','system','data','analysis','communication','trading','knowledge')),
  parameters      jsonb       NOT NULL DEFAULT '{}',  -- JSON Schema object
  returns         jsonb       DEFAULT '{}',           -- Return type schema
  enabled         boolean     NOT NULL DEFAULT true,
  requires_approval boolean   NOT NULL DEFAULT false,
  timeout_ms      int         DEFAULT 30000,
  usage_count     int         DEFAULT 0,
  last_used_at    timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (user_id, name)
);

ALTER TABLE public.mavis_tool_registry ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own tools"
    ON public.mavis_tool_registry FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_tool_registry_category
  ON public.mavis_tool_registry(category, enabled);

-- ── Automation Rules (OpenJarvis event-driven pattern) ────────────────────────
-- Maps system events to MAVIS actions. Evaluates conditions client-side,
-- executes actions via the AutomationEngine.
CREATE TABLE IF NOT EXISTS public.mavis_automation_rules (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,

  -- Trigger definition
  trigger_event   text        NOT NULL,  -- 'network:offline' | 'network:online' | 'schedule:daily' |
                                         -- 'metric:threshold' | 'agent:signal' | 'custom'
  trigger_config  jsonb       DEFAULT '{}',  -- e.g. { "metric": "memory_mb", "threshold": 1024, "op": "gt" }

  -- Optional JS-safe condition expression evaluated at trigger time
  -- Variables available: event, context (AppStateSnapshot), now
  condition_expr  text,                  -- e.g. "context.energy < 30"

  -- Action to execute
  action_type     text        NOT NULL
                              CHECK (action_type IN (
                                'send_agent_message','invoke_skill','invoke_plugin_action',
                                'store_memory','run_distillation','notify_operator','custom'
                              )),
  action_config   jsonb       NOT NULL DEFAULT '{}',

  -- State
  enabled         boolean     NOT NULL DEFAULT true,
  cooldown_ms     int         DEFAULT 300000,  -- Min ms between triggers (5 min default)
  last_triggered_at timestamptz,
  trigger_count   int         NOT NULL DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.mavis_automation_rules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own automation rules"
    ON public.mavis_automation_rules FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_automation_rules_event
  ON public.mavis_automation_rules(trigger_event, enabled);

-- ── Ephemeral Agent Sessions (ElizaOS dynamic formation) ──────────────────────
-- Tracks short-lived agents spun up for specific tasks. Cleaned up after
-- completion; learnings are stored in mavis_agent_memories before teardown.
CREATE TABLE IF NOT EXISTS public.mavis_agent_sessions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  agent_id        text        NOT NULL,  -- ephemeral/{uuid}
  agent_name      text        NOT NULL,
  agent_type      text        NOT NULL DEFAULT 'ephemeral'
                              CHECK (agent_type IN ('council','persona','plugin','mavis','ephemeral')),

  task            text        NOT NULL,  -- Original task description
  goal            text,                  -- Decomposed high-level goal
  sub_tasks       jsonb       DEFAULT '[]',  -- [{ id, description, status, result }]

  -- Lifecycle
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','completed','failed','cancelled')),
  result          text,
  error_msg       text,

  -- Resources used
  tools_used      text[]      DEFAULT '{}',
  memory_ids      uuid[]      DEFAULT '{}',
  llm_calls       int         DEFAULT 0,
  tokens_used     int         DEFAULT 0,

  started_at      timestamptz DEFAULT now(),
  completed_at    timestamptz
);

ALTER TABLE public.mavis_agent_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own agent sessions"
    ON public.mavis_agent_sessions FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_sessions_status
  ON public.mavis_agent_sessions(status, started_at DESC);

-- ── Distillation Jobs (Felix AI knowledge compression) ────────────────────────
-- Tracks async knowledge compression runs. Input: raw notes/journal/messages.
-- Output: distilled semantic memories stored in mavis_agent_memories.
CREATE TABLE IF NOT EXISTS public.mavis_distillation_jobs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  triggered_by    text        DEFAULT 'manual',  -- 'manual' | 'schedule' | 'automation'

  -- Source configuration
  source_types    text[]      NOT NULL,           -- ['notes','journal','vault','messages','mixed']
  source_filter   jsonb       DEFAULT '{}',       -- { date_from, date_to, tags, min_importance }

  -- Processing state
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','running','complete','failed')),
  input_count     int         DEFAULT 0,          -- Source items processed
  chunk_count     int         DEFAULT 0,          -- Text chunks created
  output_count    int         DEFAULT 0,          -- Distilled memories stored

  -- Results
  output_summary  text,                           -- Top-level synthesis
  compression_ratio float,                        -- input tokens / output tokens
  distilled_memory_ids uuid[] DEFAULT '{}',

  -- Timing
  started_at      timestamptz,
  completed_at    timestamptz,
  error_msg       text,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE public.mavis_distillation_jobs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own distillation jobs"
    ON public.mavis_distillation_jobs FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_distillation_jobs_status
  ON public.mavis_distillation_jobs(status, created_at DESC);



-- ======== 20260520000000_mcp_integration.sql ========
-- MCP Integration — tool execution logging + knowledge graph traversal indexes
-- Safe to re-run: all statements use IF NOT EXISTS / OR REPLACE guards.

-- ── MCP tool execution log ────────────────────────────────────────────────────
-- Records every MAVIS tool call: what ran, how long it took, success/failure.
-- Powers the IntegrationsPage analytics and future tool-quality scoring.

CREATE TABLE IF NOT EXISTS mavis_tool_executions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_name    text NOT NULL,
  params       jsonb,
  result       jsonb,
  success      boolean NOT NULL DEFAULT true,
  error_msg    text,
  duration_ms  integer,
  provider     text,   -- "stagehand-local" | "browserbase-cloud" | "fetch-fallback" | "n8n-mcp" | "native"
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mavis_tool_executions_user_idx  ON mavis_tool_executions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mavis_tool_executions_tool_idx  ON mavis_tool_executions(tool_name);

ALTER TABLE mavis_tool_executions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "tool_exec_own" ON mavis_tool_executions
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Knowledge graph traversal indexes ────────────────────────────────────────
-- Fast BFS over mavis_note_wikilinks requires covering indexes on both
-- source and target columns. The target_slug → note_id resolve also
-- needs a case-insensitive index on mavis_notes.title.

CREATE INDEX IF NOT EXISTS mavis_note_wikilinks_source_idx
  ON mavis_note_wikilinks(user_id, source_note_id);

CREATE INDEX IF NOT EXISTS mavis_note_wikilinks_slug_idx
  ON mavis_note_wikilinks(user_id, lower(target_slug));

CREATE INDEX IF NOT EXISTS mavis_notes_title_lower_idx
  ON mavis_notes(user_id, lower(title));

-- ── Workflow execution log ────────────────────────────────────────────────────
-- Stores n8n workflow blueprints built by MAVIS and their execution outcomes.

CREATE TABLE IF NOT EXISTS mavis_workflow_executions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workflow_name   text NOT NULL,
  n8n_workflow_id text,                        -- ID in connected n8n instance
  blueprint       jsonb,                       -- the workflow JSON MAVIS built
  trigger_data    jsonb,
  execution_id    text,                        -- n8n execution ID
  status          text NOT NULL DEFAULT 'pending',  -- pending | running | success | error
  result_data     jsonb,
  error_msg       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

ALTER TABLE mavis_workflow_executions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "workflow_exec_own" ON mavis_workflow_executions
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Sequential thought log ────────────────────────────────────────────────────
-- Stores reasoning chains MAVIS ran before complex actions.
-- Enables post-hoc auditing of why a decision was made.

CREATE TABLE IF NOT EXISTS mavis_thought_chains (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal            text NOT NULL,
  mode            text NOT NULL DEFAULT 'chain',
  steps_taken     integer NOT NULL DEFAULT 0,
  revisions_used  integer NOT NULL DEFAULT 0,
  conclusion      text,
  full_chain      jsonb,   -- serialized ThoughtChain
  triggered_by    text,    -- which tool / action requested the reasoning
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mavis_thought_chains ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "thought_chains_own" ON mavis_thought_chains
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;



-- ======== 20260523233443_9db55db4-883f-4ecd-a772-0d5cb0f71cd2.sql ========

-- 1) mavis-products storage hardening
DROP POLICY IF EXISTS "mavis-products authenticated insert" ON storage.objects;

DO $$ BEGIN
  CREATE POLICY "mavis-products owner insert"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'mavis-products'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "mavis-products owner update"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
      bucket_id = 'mavis-products'
      AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
      bucket_id = 'mavis-products'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "mavis-products owner delete"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'mavis-products'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2) Pin search_path on our trigger function
ALTER FUNCTION public.update_mavis_products_updated_at() SET search_path = public;

-- 3) Lock down SECURITY DEFINER functions that are not meant to be RPC-callable
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_default_workspaces() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_mavis_notes(vector, uuid, double precision, integer) FROM PUBLIC, anon, authenticated;



-- ======== 20260525011557_9f02c24d-ba0a-4c0f-9549-6667345a222c.sql ========
-- Tighten agent_telegram_config policy to authenticated only
DROP POLICY IF EXISTS "users own telegram config" ON public.agent_telegram_config;
DO $$ BEGIN
  CREATE POLICY "Users manage own telegram config"
  ON public.agent_telegram_config
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add UPDATE policy for mavis_note_links
DO $$ BEGIN
  CREATE POLICY "Users update own note links"
  ON public.mavis_note_links
  FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mavis_notes n WHERE n.id = mavis_note_links.source_note_id AND n.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.mavis_notes n WHERE n.id = mavis_note_links.source_note_id AND n.user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add DELETE policy for mavis_note_versions
DO $$ BEGIN
  CREATE POLICY "Users delete own note versions"
  ON public.mavis_note_versions
  FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mavis_notes n WHERE n.id = mavis_note_versions.note_id AND n.user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ======== 20260529000000_add_memory_embeddings.sql ========
-- Enable pgvector (safe if already enabled)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add 768-dimensional embedding column to mavis_agent_memories (Gemini text-embedding-004)
DO $$ BEGIN
  ALTER TABLE mavis_agent_memories
    ADD COLUMN IF NOT EXISTS embedding vector(768);
EXCEPTION WHEN undefined_table THEN NULL; WHEN others THEN NULL;
END $$;

-- IVFFlat index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS mavis_memories_embedding_idx
  ON mavis_agent_memories
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Semantic similarity search function
CREATE OR REPLACE FUNCTION search_memories_semantic(
  query_embedding vector(768),
  match_user_id   uuid,
  match_count     int DEFAULT 6
)
RETURNS TABLE (
  id            uuid,
  content       text,
  memory_type   text,
  tags          text[],
  importance    int,
  created_at    timestamptz,
  similarity    float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    content,
    memory_type,
    tags,
    importance,
    created_at,
    1 - (embedding <=> query_embedding) AS similarity
  FROM mavis_agent_memories
  WHERE user_id = match_user_id
    AND status = 'active'
    AND embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;



-- ======== 20260529000001_hybrid_search_decay.sql ========
-- Hybrid search + episodic memory decay for mavis_agent_memories

-- 1. Add tsvector column for BM25-style full-text search
DO $$ BEGIN
  ALTER TABLE mavis_agent_memories
    ADD COLUMN IF NOT EXISTS fts tsvector
      GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;
EXCEPTION WHEN undefined_table THEN NULL; WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS mavis_memories_fts_idx
  ON mavis_agent_memories USING gin(fts);

-- 2. Add episodic memory decay tracking columns
DO $$ BEGIN
  ALTER TABLE mavis_agent_memories
    ADD COLUMN IF NOT EXISTS last_accessed_at timestamptz DEFAULT now(),
    ADD COLUMN IF NOT EXISTS access_count int DEFAULT 0 NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL; WHEN others THEN NULL;
END $$;

-- 3. Hybrid search function: BM25 + pgvector cosine + RRF merge + temporal decay
CREATE OR REPLACE FUNCTION search_memories_hybrid(
  query_embedding  vector(768),
  query_text       text,
  match_user_id    uuid,
  match_count      int DEFAULT 6
)
RETURNS TABLE (
  id            uuid,
  content       text,
  memory_type   text,
  tags          text[],
  importance    int,
  created_at    timestamptz,
  score         float
)
LANGUAGE sql STABLE
AS $$
  WITH semantic AS (
    SELECT id,
           row_number() OVER (ORDER BY embedding <=> query_embedding) AS rank
    FROM mavis_agent_memories
    WHERE user_id = match_user_id
      AND status  = 'active'
      AND embedding IS NOT NULL
    ORDER BY embedding <=> query_embedding
    LIMIT 20
  ),
  keyword AS (
    SELECT id,
           row_number() OVER (
             ORDER BY ts_rank_cd(fts, plainto_tsquery('english', query_text)) DESC
           ) AS rank
    FROM mavis_agent_memories
    WHERE user_id = match_user_id
      AND status  = 'active'
      AND fts @@ plainto_tsquery('english', query_text)
    ORDER BY ts_rank_cd(fts, plainto_tsquery('english', query_text)) DESC
    LIMIT 20
  ),
  rrf AS (
    SELECT coalesce(s.id, k.id) AS id,
           coalesce(1.0 / (60.0 + s.rank), 0.0) +
           coalesce(1.0 / (60.0 + k.rank), 0.0) AS rrf_score
    FROM semantic s FULL OUTER JOIN keyword k ON s.id = k.id
  )
  SELECT
    m.id,
    m.content,
    m.memory_type,
    m.tags,
    m.importance,
    m.created_at,
    -- decay: recency × engagement bonus
    r.rrf_score
      * (0.6 + 0.4 * exp(
          -extract(epoch from (now() - coalesce(m.last_accessed_at, m.created_at))) / 2592000.0
        ))
      * ln(1.0 + coalesce(m.access_count, 0))
      AS score
  FROM rrf r
  JOIN mavis_agent_memories m ON r.id = m.id
  ORDER BY score DESC
  LIMIT match_count;
$$;

-- 4. Update access tracking when a memory is retrieved
CREATE OR REPLACE FUNCTION bump_memory_access(memory_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE mavis_agent_memories
  SET last_accessed_at = now(),
      access_count     = coalesce(access_count, 0) + 1
  WHERE id = memory_id;
$$;

-- 5. Also add tsvector + decay to mavis_notes (knowledge graph) for consistency
DO $$ BEGIN
  ALTER TABLE mavis_notes
    ADD COLUMN IF NOT EXISTS fts tsvector
      GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))) STORED;
EXCEPTION WHEN undefined_table THEN NULL; WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS mavis_notes_fts_idx
  ON mavis_notes USING gin(fts);

DO $$ BEGIN
  ALTER TABLE mavis_notes
    ADD COLUMN IF NOT EXISTS last_accessed_at timestamptz DEFAULT now(),
    ADD COLUMN IF NOT EXISTS access_count int DEFAULT 0 NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL; WHEN others THEN NULL;
END $$;



-- ======== 20260529000002_notification_budget.sql ========
-- Smart notification budget: each user gets 5 notification slots per day.
-- Notifications are deducted from the budget; highest-priority fire first.

CREATE TABLE IF NOT EXISTS notification_budget (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date         date NOT NULL DEFAULT current_date,
  slots_used   int  NOT NULL DEFAULT 0,
  slots_total  int  NOT NULL DEFAULT 5,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

ALTER TABLE notification_budget ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own budget" ON notification_budget
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Notification priority log (for analytics/tuning)
CREATE TABLE IF NOT EXISTS notification_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type          text NOT NULL, -- streak_risk | deadline | energy | contract_violation | motivational
  title         text NOT NULL,
  body          text,
  priority      int  NOT NULL DEFAULT 5, -- 1 (highest) to 10 (lowest)
  sent_at       timestamptz DEFAULT now(),
  opened        boolean DEFAULT false,
  opened_at     timestamptz
);

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users view own log" ON notification_log
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Function: consume one notification slot
-- Returns true if slot was available, false if budget exhausted
CREATE OR REPLACE FUNCTION consume_notification_slot(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_used int;
  v_total int;
BEGIN
  INSERT INTO notification_budget (user_id, date, slots_used, slots_total)
  VALUES (p_user_id, current_date, 0, 5)
  ON CONFLICT (user_id, date) DO NOTHING;

  SELECT slots_used, slots_total
  INTO v_used, v_total
  FROM notification_budget
  WHERE user_id = p_user_id AND date = current_date
  FOR UPDATE;

  IF v_used >= v_total THEN
    RETURN false;
  END IF;

  UPDATE notification_budget
  SET slots_used = slots_used + 1, updated_at = now()
  WHERE user_id = p_user_id AND date = current_date;

  RETURN true;
END;
$$;



-- ======== 20260529000003_emotion_scores.sql ========
-- Add structured emotion scores to journal entries
-- Uses Hume AI Expression Measurement API results (48-dim emotion vector stored as jsonb)

DO $$ BEGIN
  ALTER TABLE journal_entries
    ADD COLUMN IF NOT EXISTS emotion_scores  jsonb,
    ADD COLUMN IF NOT EXISTS emotion_tagged  boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS dominant_emotion text;
EXCEPTION WHEN undefined_table THEN NULL; WHEN others THEN NULL;
END $$;

-- Index for emotion-based queries (e.g., "show me all anxious entries")
CREATE INDEX IF NOT EXISTS journal_emotion_idx
  ON journal_entries USING gin(emotion_scores);

-- Index for dominant emotion filtering
CREATE INDEX IF NOT EXISTS journal_dominant_emotion_idx
  ON journal_entries (user_id, dominant_emotion)
  WHERE dominant_emotion IS NOT NULL;

-- Emotion trend view: aggregated weekly emotion averages per user
CREATE OR REPLACE VIEW emotion_weekly_trends AS
  SELECT
    user_id,
    date_trunc('week', created_at) AS week,
    dominant_emotion,
    count(*) AS entry_count,
    avg((emotion_scores->>'determination')::float) AS avg_determination,
    avg((emotion_scores->>'anxiety')::float)       AS avg_anxiety,
    avg((emotion_scores->>'joy')::float)            AS avg_joy,
    avg((emotion_scores->>'sadness')::float)        AS avg_sadness,
    avg((emotion_scores->>'excitement')::float)     AS avg_excitement,
    avg((emotion_scores->>'tiredness')::float)      AS avg_tiredness,
    avg((emotion_scores->>'focus')::float)          AS avg_focus,
    avg((emotion_scores->>'pride')::float)          AS avg_pride,
    avg((emotion_scores->>'frustration')::float)    AS avg_frustration,
    avg((emotion_scores->>'gratitude')::float)      AS avg_gratitude
  FROM journal_entries
  WHERE emotion_scores IS NOT NULL
  GROUP BY user_id, week, dominant_emotion;



-- ======== 20260529000004_plan_execute.sql ========
-- Plan-and-Execute agent: stores goal DAGs decomposed by the planner

CREATE TABLE IF NOT EXISTS mavis_plans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        text NOT NULL,
  goal         text NOT NULL,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','paused','failed')),
  total_steps  int  NOT NULL DEFAULT 0,
  done_steps   int  NOT NULL DEFAULT 0,
  context      jsonb,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mavis_plan_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id      uuid NOT NULL REFERENCES mavis_plans(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  step_index   int  NOT NULL,
  title        text NOT NULL,
  description  text,
  type         text NOT NULL DEFAULT 'execute' CHECK (type IN ('research','write','execute','create_quest','notify','wait')),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','skipped')),
  depends_on   uuid[], -- IDs of steps that must complete first
  result       text,
  error        text,
  actions      jsonb, -- MAVIS actions to execute for this step
  started_at   timestamptz,
  completed_at timestamptz,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE mavis_plans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE mavis_plan_steps  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users manage own plans"      ON mavis_plans      FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Users manage own plan steps" ON mavis_plan_steps FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS plan_steps_plan_idx   ON mavis_plan_steps (plan_id, step_index);
CREATE INDEX IF NOT EXISTS plan_steps_status_idx ON mavis_plan_steps (user_id, status);



-- ======== 20260529000005_game_master.sql ========
-- GAME_MASTER mode: streak insurance, consequence quests, dynamic difficulty

-- Streak insurance: allows users to protect one streak break per period
CREATE TABLE IF NOT EXISTS streak_insurance (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id      uuid REFERENCES tasks(id) ON DELETE SET NULL,
  quest_id     uuid REFERENCES quests(id) ON DELETE SET NULL,
  used_at      timestamptz,
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  status       text NOT NULL DEFAULT 'available' CHECK (status IN ('available','used','expired')),
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE streak_insurance ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own insurance" ON streak_insurance
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Consequence quest linking: failing a habit quest can trigger a consequence
DO $$ BEGIN
  ALTER TABLE quests
    ADD COLUMN IF NOT EXISTS consequence_quest_id uuid REFERENCES quests(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS difficulty_rating     float DEFAULT 5.0 CHECK (difficulty_rating BETWEEN 1 AND 10),
    ADD COLUMN IF NOT EXISTS is_consequence        boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS parent_task_id        uuid REFERENCES tasks(id) ON DELETE SET NULL;
EXCEPTION WHEN undefined_table THEN NULL; WHEN others THEN NULL;
END $$;

-- GAME_MASTER event log: narrative events generated by the game master
CREATE TABLE IF NOT EXISTS game_master_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type   text NOT NULL, -- streak_broken | streak_milestone | challenge_unlocked | consequence_triggered | level_up_narrative
  title        text NOT NULL,
  narrative    text,
  xp_delta     int  DEFAULT 0,
  quest_ids    uuid[],
  metadata     jsonb,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE game_master_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users view own events" ON game_master_events
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Dynamic difficulty tracking per user
CREATE TABLE IF NOT EXISTS user_difficulty_profile (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_level  float NOT NULL DEFAULT 5.0,
  avg_completion float NOT NULL DEFAULT 0.7,
  streak_avg     float NOT NULL DEFAULT 0.0,
  last_adjusted  timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

ALTER TABLE user_difficulty_profile ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own difficulty" ON user_difficulty_profile
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;



-- ======== 20260529000006_tool_usage_rpc.sql ========
-- RPC called by toolRegistry.ts to track tool usage analytics
-- mavis_tool_registry already exists from earlier migration
CREATE OR REPLACE FUNCTION increment_tool_usage(p_tool_name text)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE mavis_tool_registry
  SET usage_count = coalesce(usage_count, 0) + 1,
      last_used_at = now()
  WHERE name = p_tool_name;
$$;



-- ======== 20260529000007_mem0_letta.sql ========
-- Mem0 sync log: tracks which conversations have been synced to Mem0
CREATE TABLE IF NOT EXISTS mavis_mem0_sync_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  conversation_id text,
  synced_at timestamptz DEFAULT now(),
  memory_count int DEFAULT 0,
  UNIQUE(user_id, conversation_id)
);
ALTER TABLE mavis_mem0_sync_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own mem0 log" ON mavis_mem0_sync_log FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Letta agent registry: one Letta agent per MAVIS mode/persona
CREATE TABLE IF NOT EXISTS mavis_letta_agents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  letta_agent_id text NOT NULL,
  persona_name text NOT NULL DEFAULT 'MAVIS',
  created_at timestamptz DEFAULT now(),
  last_messaged_at timestamptz,
  UNIQUE(user_id, persona_name)
);
ALTER TABLE mavis_letta_agents ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own letta agents" ON mavis_letta_agents FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;



-- ======== 20260529000008_video_gen.sql ========
-- Video generation job tracking
CREATE TABLE IF NOT EXISTS mavis_video_jobs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  prompt text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  request_id text,
  operation_name text,
  video_url text,
  duration_seconds int,
  aspect_ratio text DEFAULT '16:9',
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  error_message text
);
ALTER TABLE mavis_video_jobs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own video jobs" ON mavis_video_jobs FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX idx_video_jobs_user ON mavis_video_jobs(user_id, created_at DESC);



-- ======== 20260529000009_health_apis.sql ========
-- WHOOP OAuth tokens (one per user)
CREATE TABLE IF NOT EXISTS whoop_tokens (
  user_id uuid REFERENCES auth.users PRIMARY KEY,
  access_token text NOT NULL,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE whoop_tokens ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own whoop tokens" ON whoop_tokens FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- WHOOP daily health data
CREATE TABLE IF NOT EXISTS whoop_daily_data (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  date date NOT NULL,
  recovery_score numeric,
  hrv_rmssd numeric,
  resting_hr numeric,
  sleep_performance numeric,
  sleep_hours numeric,
  strain_score numeric,
  calories int,
  biomarkers jsonb DEFAULT '{}',
  raw_data jsonb DEFAULT '{}',
  synced_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);
ALTER TABLE whoop_daily_data ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own whoop data" ON whoop_daily_data FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX idx_whoop_user_date ON whoop_daily_data(user_id, date DESC);

-- Samsung Galaxy Ring daily data
CREATE TABLE IF NOT EXISTS galaxy_ring_daily_data (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  date date NOT NULL,
  sleep_score numeric,
  cognitive_score numeric,
  stress_level numeric,
  hrv_rmssd numeric,
  spo2 numeric,
  skin_temp_c numeric,
  steps int,
  active_calories int,
  raw_data jsonb DEFAULT '{}',
  synced_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);
ALTER TABLE galaxy_ring_daily_data ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own ring data" ON galaxy_ring_daily_data FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX idx_ring_user_date ON galaxy_ring_daily_data(user_id, date DESC);

-- Health integration settings
CREATE TABLE IF NOT EXISTS health_integration_settings (
  user_id uuid REFERENCES auth.users PRIMARY KEY,
  whoop_enabled boolean DEFAULT false,
  galaxy_ring_enabled boolean DEFAULT false,
  oura_enabled boolean DEFAULT false,
  auto_sync_interval_hours int DEFAULT 6,
  sync_to_mavis_context boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE health_integration_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own health settings" ON health_integration_settings FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;



-- ======== 20260529000010_agentic_integrations.sql ========
-- A2A protocol task queue
CREATE TABLE IF NOT EXISTS a2a_tasks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  external_agent_id text,
  skill_id text NOT NULL,
  status text NOT NULL DEFAULT 'submitted',
  input_message text NOT NULL,
  output_message text,
  artifacts jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE a2a_tasks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own a2a tasks" ON a2a_tasks FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX idx_a2a_tasks_user ON a2a_tasks(user_id, created_at DESC);

-- Code delegation sessions (Devin/Cursor)
CREATE TABLE IF NOT EXISTS code_delegation_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  provider text NOT NULL DEFAULT 'devin',
  external_session_id text,
  task_description text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  session_url text,
  prs_created jsonb DEFAULT '[]',
  messages jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE code_delegation_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own code sessions" ON code_delegation_sessions FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Computer use task log
CREATE TABLE IF NOT EXISTS computer_use_tasks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  task_description text NOT NULL,
  model text NOT NULL DEFAULT 'computer-use-preview',
  actions_taken jsonb DEFAULT '[]',
  status text NOT NULL DEFAULT 'pending',
  result text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE computer_use_tasks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own computer use" ON computer_use_tasks FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;



-- ======== 20260529000011_finance_education.sql ========
-- Finance, scheduling, and education data tables
-- Era.app financial cache, Reclaim.ai schedule blocks, Khanmigo tutoring sessions

-- Financial data cache
CREATE TABLE IF NOT EXISTS era_financial_cache (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  cache_type text NOT NULL, -- 'accounts', 'transactions', 'goals', 'net_worth'
  data jsonb NOT NULL DEFAULT '{}',
  period_start date,
  period_end date,
  synced_at timestamptz DEFAULT now(),
  UNIQUE(user_id, cache_type, period_start)
);
ALTER TABLE era_financial_cache ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own finance cache" ON era_financial_cache FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Reclaim.ai schedule blocks
CREATE TABLE IF NOT EXISTS reclaim_schedule_blocks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  reclaim_task_id text,
  title text NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  block_type text DEFAULT 'task',
  health_triggered boolean DEFAULT false,
  synced_at timestamptz DEFAULT now()
);
ALTER TABLE reclaim_schedule_blocks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own schedule" ON reclaim_schedule_blocks FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX idx_reclaim_user_time ON reclaim_schedule_blocks(user_id, start_time);

-- Khanmigo Socratic tutoring sessions
CREATE TABLE IF NOT EXISTS tutoring_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  subject text NOT NULL,
  topic_id text,
  messages jsonb DEFAULT '[]',
  current_problem text,
  solved boolean DEFAULT false,
  hints_used int DEFAULT 0,
  time_spent_seconds int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE tutoring_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own tutoring" ON tutoring_sessions FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX idx_tutoring_user ON tutoring_sessions(user_id, created_at DESC);



-- ======== 20260529000012_social_wearables.sql ========
-- NORA content pipeline queue
CREATE TABLE IF NOT EXISTS nora_content_queue (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  platform text NOT NULL,
  content text NOT NULL,
  hashtags text[],
  scheduled_for timestamptz,
  posted_at timestamptz,
  status text NOT NULL DEFAULT 'draft',
  performance_data jsonb DEFAULT '{}',
  ai_generated boolean DEFAULT true,
  source_topic text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE nora_content_queue ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own nora content" ON nora_content_queue FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX idx_nora_content_user ON nora_content_queue(user_id, scheduled_for);

-- Screenpipe memory sync log
CREATE TABLE IF NOT EXISTS screenpipe_sync_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  synced_at timestamptz DEFAULT now(),
  items_synced int DEFAULT 0,
  memories_created int DEFAULT 0,
  context_window_minutes int DEFAULT 30
);
ALTER TABLE screenpipe_sync_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own screenpipe log" ON screenpipe_sync_log FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Wearable overlay history
CREATE TABLE IF NOT EXISTS wearable_overlay_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  device_type text NOT NULL,
  content text NOT NULL,
  overlay_type text DEFAULT 'ambient',
  displayed_at timestamptz DEFAULT now(),
  duration_ms int
);
ALTER TABLE wearable_overlay_history ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own overlay history" ON wearable_overlay_history FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;



-- ======== 20260529000013_website_builder.sql ========
-- Website clients (per service customer)
CREATE TABLE IF NOT EXISTS website_clients (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  client_name text NOT NULL,
  client_email text,
  client_phone text,
  business_name text,
  business_type text,
  location text,
  notes text,
  project_count int DEFAULT 0,
  total_value_cents int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE website_clients ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own clients" ON website_clients FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX idx_website_clients_user ON website_clients(user_id, created_at DESC);

-- Website projects (one project = one client website)
CREATE TABLE IF NOT EXISTS website_projects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  client_id uuid REFERENCES website_clients ON DELETE SET NULL,
  project_name text NOT NULL,
  business_name text,
  business_type text DEFAULT 'local_business',
  description text,
  target_audience text,
  unique_value text,
  location text,
  style text DEFAULT 'modern',
  color_scheme text DEFAULT 'blue',
  pages_requested text[] DEFAULT ARRAY['home','about','services','contact'],
  status text NOT NULL DEFAULT 'planning',
  wp_site_url text,
  pages_count int DEFAULT 0,
  site_content jsonb,
  hero_image_url text,
  preview_url text,
  price_cents int,
  paid boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  published_at timestamptz,
  delivered_at timestamptz
);
ALTER TABLE website_projects ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own projects" ON website_projects FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX idx_website_projects_user ON website_projects(user_id, created_at DESC);
CREATE INDEX idx_website_projects_client ON website_projects(client_id);

-- WordPress credentials (per site)
CREATE TABLE IF NOT EXISTS wp_credentials (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  project_id uuid REFERENCES website_projects ON DELETE CASCADE,
  site_url text NOT NULL,
  wp_username text NOT NULL,
  app_password text NOT NULL,
  label text,
  verified boolean DEFAULT false,
  last_used_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE wp_credentials ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own wp creds" ON wp_credentials FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Generated website pages
CREATE TABLE IF NOT EXISTS website_pages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES website_projects ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,
  page_type text NOT NULL,
  wp_page_id int,
  title text,
  slug text,
  content_brief text,
  blocks_json text,
  meta_title text,
  meta_description text,
  hero_image_url text,
  status text DEFAULT 'draft',
  wp_url text,
  seo_score int,
  created_at timestamptz DEFAULT now(),
  published_at timestamptz,
  UNIQUE(project_id, page_type)
);
ALTER TABLE website_pages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own pages" ON website_pages FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX idx_website_pages_project ON website_pages(project_id);

-- Website generation jobs (track long-running builds)
CREATE TABLE IF NOT EXISTS website_generation_jobs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  project_id uuid REFERENCES website_projects ON DELETE CASCADE NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  current_step text,
  steps_total int DEFAULT 0,
  steps_completed int DEFAULT 0,
  error_message text,
  result jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE website_generation_jobs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own jobs" ON website_generation_jobs FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Service pricing tiers
CREATE TABLE IF NOT EXISTS website_service_tiers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  tier_name text NOT NULL,
  description text,
  pages_included int DEFAULT 5,
  price_cents int NOT NULL,
  includes_ecommerce boolean DEFAULT false,
  includes_blog boolean DEFAULT false,
  includes_seo boolean DEFAULT true,
  includes_revisions int DEFAULT 2,
  turnaround_days int DEFAULT 3,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE website_service_tiers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own tiers" ON website_service_tiers FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Seed default service tiers (runs on first insert)
-- Users will customize these



-- ======== 20260529000014_widget_system.sql ========
-- Widget instances (each deployed widget = one row)
CREATE TABLE IF NOT EXISTS widget_instances (
  id text PRIMARY KEY,                          -- 12-char alphanumeric widget ID
  user_id uuid REFERENCES auth.users NOT NULL,
  project_id uuid REFERENCES website_projects ON DELETE SET NULL,
  widget_type text NOT NULL,                    -- chat|lead_capture|quote_calculator|faq|roi_calculator|appointment_booker
  config jsonb NOT NULL DEFAULT '{}',           -- all widget configuration
  business_context text,                        -- extra AI context
  public_url text,                              -- CDN URL of widget.js
  status text NOT NULL DEFAULT 'active',        -- active|paused|deleted
  monthly_price_cents int DEFAULT 4900,
  subscription_status text DEFAULT 'trial',     -- trial|active|cancelled
  trial_ends_at timestamptz DEFAULT (now() + interval '14 days'),
  total_requests int DEFAULT 0,
  total_leads int DEFAULT 0,
  total_conversations int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE widget_instances ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own widgets" ON widget_instances FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX idx_widgets_user ON widget_instances(user_id, created_at DESC);
CREATE INDEX idx_widgets_project ON widget_instances(project_id);

-- Widget chat logs
CREATE TABLE IF NOT EXISTS widget_chat_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  widget_id text REFERENCES widget_instances NOT NULL,
  session_id text NOT NULL,
  message text NOT NULL,
  reply text NOT NULL,
  response_ms int,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE widget_chat_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own chat logs" ON widget_chat_logs FOR ALL
    USING (EXISTS (SELECT 1 FROM widget_instances WHERE id = widget_chat_logs.widget_id AND user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX idx_chat_logs_widget ON widget_chat_logs(widget_id, created_at DESC);

-- Widget leads (from lead capture, quote calculator, appointment booker)
CREATE TABLE IF NOT EXISTS widget_leads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  widget_id text REFERENCES widget_instances NOT NULL,
  lead_type text NOT NULL DEFAULT 'contact',   -- contact|quote|roi|appointment
  name text,
  email text,
  phone text,
  company text,
  message text,
  source_url text,
  metadata jsonb DEFAULT '{}',                 -- quote inputs, appointment details, etc.
  status text NOT NULL DEFAULT 'new',          -- new|contacted|converted|lost
  contacted_at timestamptz,
  converted_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE widget_leads ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own leads" ON widget_leads FOR ALL
    USING (EXISTS (SELECT 1 FROM widget_instances WHERE id = widget_leads.widget_id AND user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX idx_leads_widget ON widget_leads(widget_id, created_at DESC);
CREATE INDEX idx_leads_status ON widget_leads(status, created_at DESC);

-- Widget daily usage stats
CREATE TABLE IF NOT EXISTS widget_usage_stats (
  widget_id text REFERENCES widget_instances NOT NULL,
  date date NOT NULL DEFAULT current_date,
  action_type text NOT NULL,
  request_count int DEFAULT 0,
  PRIMARY KEY (widget_id, date, action_type)
);
ALTER TABLE widget_usage_stats ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "user own usage" ON widget_usage_stats FOR ALL
    USING (EXISTS (SELECT 1 FROM widget_instances WHERE id = widget_usage_stats.widget_id AND user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Increment usage count RPC
CREATE OR REPLACE FUNCTION increment_widget_usage(p_widget_id text, p_action text)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO widget_usage_stats(widget_id, date, action_type, request_count)
  VALUES (p_widget_id, current_date, p_action, 1)
  ON CONFLICT (widget_id, date, action_type)
  DO UPDATE SET request_count = widget_usage_stats.request_count + 1;
$$;

-- Widget monthly revenue view (for billing dashboard)
CREATE OR REPLACE VIEW widget_revenue_summary AS
SELECT
  w.user_id,
  COUNT(*) as total_widgets,
  COUNT(*) FILTER (WHERE w.subscription_status = 'active') as active_widgets,
  SUM(w.monthly_price_cents) FILTER (WHERE w.subscription_status = 'active') as mrr_cents,
  SUM(w.total_leads) as total_leads_captured,
  SUM(w.total_requests) as total_api_requests
FROM widget_instances w
GROUP BY w.user_id;

-- Supabase Storage bucket for widget JS files (public)
-- Note: actual bucket creation requires Supabase dashboard or CLI
-- Run: supabase storage buckets create widgets --public
-- This migration documents the requirement
DO $$
BEGIN
  RAISE NOTICE 'REQUIRED: Create a public Supabase Storage bucket named "widgets" via dashboard or CLI: supabase storage buckets create widgets --public';
END $$;



-- ======== 20260530000001_mavis_planner.sql ========
-- Extend mavis_plans with columns used by the mavis-planner edge function
DO $$ BEGIN
  ALTER TABLE mavis_plans
    ADD COLUMN IF NOT EXISTS summary text,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
EXCEPTION WHEN undefined_table THEN NULL; WHEN others THEN NULL;
END $$;

-- Extend mavis_plan_steps with phase-based planning columns used by mavis-planner
DO $$ BEGIN
  ALTER TABLE mavis_plan_steps
    ADD COLUMN IF NOT EXISTS phase text,
    ADD COLUMN IF NOT EXISTS step_order int,
    ADD COLUMN IF NOT EXISTS estimated_minutes int DEFAULT 30,
    ADD COLUMN IF NOT EXISTS quest_id uuid;
EXCEPTION WHEN undefined_table THEN NULL; WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_mavis_plan_steps_plan_id ON mavis_plan_steps(plan_id);



-- ======== 20260530000002_stripe_widget_billing.sql ========
DO $$ BEGIN
  ALTER TABLE widget_instances
    ADD COLUMN IF NOT EXISTS stripe_customer_id text,
    ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
    ADD COLUMN IF NOT EXISTS stripe_price_id text,
    ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
    ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean DEFAULT false;
EXCEPTION WHEN undefined_table THEN NULL; WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_widget_instances_stripe_sub ON widget_instances(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_widget_instances_stripe_cust ON widget_instances(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- Track Stripe event IDs to prevent double-processing
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id text PRIMARY KEY,  -- Stripe event ID (evt_xxx)
  type text NOT NULL,
  processed_at timestamptz DEFAULT now()
);



-- ======== 20260530000003_video_editor.sql ========
-- Video projects (one per uploaded/linked video)
CREATE TABLE IF NOT EXISTS video_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  title text NOT NULL,
  source_url text,                    -- original video URL (storage or external)
  source_type text DEFAULT 'upload',  -- upload|youtube|loom|url
  duration_seconds int,
  status text DEFAULT 'pending',      -- pending|analyzing|ready|error
  transcript text,                    -- full transcript text
  transcript_chunks jsonb,            -- array of {start, end, text} word-level chunks
  gemini_analysis jsonb,              -- raw Gemini analysis output
  summary text,
  language text DEFAULT 'en',
  storage_path text,                  -- path in Supabase Storage
  thumbnail_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Scored segments (10-second windows scored across 6 dimensions)
CREATE TABLE IF NOT EXISTS video_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES video_projects ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,
  start_seconds numeric NOT NULL,
  end_seconds numeric NOT NULL,
  transcript_text text,
  score_energy numeric DEFAULT 0,       -- 0-10: voice amplitude, pace, exclamations
  score_insight numeric DEFAULT 0,      -- 0-10: semantic density, novel info, data
  score_emotion numeric DEFAULT 0,      -- 0-10: emotional language, sentiment peaks
  score_hook numeric DEFAULT 0,         -- 0-10: opens with question/surprise/claim
  score_quotability numeric DEFAULT 0,  -- 0-10: complete standalone thought
  score_visual numeric DEFAULT 0,       -- 0-10: visual energy, scene interest
  viral_score numeric DEFAULT 0,        -- 0-10: weighted composite
  segment_order int NOT NULL
);

-- Generated clips (recommended cuts for specific output formats)
CREATE TABLE IF NOT EXISTS video_clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES video_projects ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,
  title text NOT NULL,
  start_seconds numeric NOT NULL,
  end_seconds numeric NOT NULL,
  duration_seconds numeric GENERATED ALWAYS AS (end_seconds - start_seconds) STORED,
  format text NOT NULL,               -- shorts|reels|highlight|long_form|custom
  aspect_ratio text DEFAULT '9:16',   -- 9:16|16:9|1:1
  viral_score numeric DEFAULT 0,
  why_viral text,
  suggested_caption text,
  suggested_hashtags text[],
  transcript_excerpt text,
  render_status text DEFAULT 'pending', -- pending|rendering|ready|error
  render_url text,                    -- URL of rendered clip
  thumbnail_url text,
  render_job_id text,                 -- fal.ai or render provider job ID
  nora_queued boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Render jobs (async rendering queue)
CREATE TABLE IF NOT EXISTS video_render_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id uuid REFERENCES video_clips ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,
  provider text DEFAULT 'fal',
  provider_job_id text,
  status text DEFAULT 'pending',      -- pending|processing|complete|failed
  input_url text NOT NULL,
  output_url text,
  ffmpeg_cmd text,                    -- the FFmpeg command used (for transparency)
  error_message text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- RLS
ALTER TABLE video_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_render_jobs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "users own video_projects" ON video_projects FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "users own video_segments" ON video_segments FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "users own video_clips" ON video_clips FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "users own video_render_jobs" ON video_render_jobs FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_video_projects_user ON video_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_video_segments_project ON video_segments(project_id);
CREATE INDEX IF NOT EXISTS idx_video_clips_project ON video_clips(project_id);
CREATE INDEX IF NOT EXISTS idx_video_clips_format ON video_clips(project_id, format);

-- Storage bucket note
-- Run: supabase storage buckets create video-projects --public
-- Or create via dashboard: Storage → New bucket → "video-projects" → Public



-- ======== 20260530000004_sub_quests.sql ========
-- Add parent_quest_id to enable sub-quests (quests nested under parent quests).
-- Sub-quests appear in the Quests tab under their parent quest.
-- MAVIS uses create_quest with parent_quest_id instead of create_task.
DO $$ BEGIN
  ALTER TABLE quests
    ADD COLUMN IF NOT EXISTS parent_quest_id uuid REFERENCES quests(id) ON DELETE CASCADE;
EXCEPTION WHEN undefined_table THEN NULL; WHEN others THEN NULL;
END $$;

-- Index for efficient sub-quest lookup
CREATE INDEX IF NOT EXISTS idx_quests_parent_quest_id ON quests(parent_quest_id)
  WHERE parent_quest_id IS NOT NULL;

-- View: quests with sub-quest count (useful for UI badges)
CREATE OR REPLACE VIEW quest_with_sub_count AS
SELECT
  q.*,
  COUNT(sub.id) FILTER (WHERE sub.status = 'active')   AS active_sub_quest_count,
  COUNT(sub.id) FILTER (WHERE sub.status = 'completed') AS completed_sub_quest_count,
  COUNT(sub.id) AS total_sub_quest_count
FROM quests q
LEFT JOIN quests sub ON sub.parent_quest_id = q.id
WHERE q.parent_quest_id IS NULL  -- only top-level quests
GROUP BY q.id;

