-- Pally integration: loose threads, pipeline stages, contact enrichment, meeting brief tracking
-- All DDL is idempotent via IF NOT EXISTS / DO $$ blocks.

-- ── Loose Threads ──────────────────────────────────────────────────────────
-- Unresolved items MAVIS tracks across all surfaces (chat, email, Slack, calendar).
-- Analogous to Pally's "every loose thread runs into one simple conversation."
CREATE TABLE IF NOT EXISTS loose_threads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'chat'
                  CHECK (source IN ('chat','email','slack','calendar','telegram','voice')),
  source_ref    TEXT,           -- message ID, calendar event ID, Slack thread ts
  context       TEXT,           -- surrounding context (up to 500 chars)
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','snoozed','done')),
  snoozed_until TIMESTAMPTZ,
  due_at        TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE loose_threads ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own threads" ON loose_threads
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Contact Pipeline Stages ────────────────────────────────────────────────
-- Pally-style engagement pipeline tracking on the existing contacts table.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='contacts' AND column_name='pipeline_name') THEN
    ALTER TABLE contacts ADD COLUMN pipeline_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='contacts' AND column_name='pipeline_stage') THEN
    ALTER TABLE contacts ADD COLUMN pipeline_stage TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='contacts' AND column_name='pipeline_updated_at') THEN
    ALTER TABLE contacts ADD COLUMN pipeline_updated_at TIMESTAMPTZ;
  END IF;
  -- Apify-sourced enrichment (LinkedIn/X profile data, recent posts, company)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='contacts' AND column_name='enrichment') THEN
    ALTER TABLE contacts ADD COLUMN enrichment JSONB DEFAULT '{}'::jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='contacts' AND column_name='last_enriched_at') THEN
    ALTER TABLE contacts ADD COLUMN last_enriched_at TIMESTAMPTZ;
  END IF;
END $$;

-- ── Meeting Brief Dedup ────────────────────────────────────────────────────
-- Tracks which calendar events have already had pre-meeting briefs sent.
CREATE TABLE IF NOT EXISTS mavis_meeting_briefs_sent (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id    TEXT NOT NULL,
  event_start TIMESTAMPTZ NOT NULL,
  sent_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, event_id)
);
ALTER TABLE mavis_meeting_briefs_sent ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users see own meeting brief log" ON mavis_meeting_briefs_sent
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Cron: pre-meeting brief every 30 minutes ───────────────────────────────
SELECT cron.schedule('mavis-meeting-brief', '*/30 * * * *', $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-meeting-brief',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
$$);

-- ── Cron: post-meeting follow-up every 20 minutes ─────────────────────────
SELECT cron.schedule('mavis-post-meeting', '*/20 * * * *', $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-post-meeting',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
$$);
