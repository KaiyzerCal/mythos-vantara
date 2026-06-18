-- ============================================================
-- PrymalAI Client Agent Suite — Core Schema
-- Project: fjkkcrmhptrzobajjsqg
-- Run in Supabase SQL Editor for the PrymalAI project
-- ============================================================

-- ── Clients ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prymal_clients (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name       text NOT NULL,
  owner_name          text NOT NULL,
  owner_email         text NOT NULL UNIQUE,
  owner_phone         text,                          -- E.164 for SMS delivery
  industry            text,
  target_customer     text,
  tone_of_voice       text DEFAULT 'professional',
  never_say           text,                          -- comma-separated no-go phrases
  escalation_contacts jsonb DEFAULT '[]',            -- [{name, phone, email, role}]
  platforms_active    text[] DEFAULT '{}',           -- ['instagram','facebook','gmail',...]
  platforms_managed   text[] DEFAULT '{}',           -- subset PrymalAI manages
  delivery_channel    text DEFAULT 'email'           -- 'email' | 'sms' | 'both'
                      CHECK (delivery_channel IN ('email', 'sms', 'both')),
  intel_thresholds    jsonb DEFAULT '{}',            -- override DEFAULT_THRESHOLDS per client
  knowledge_base      text DEFAULT '',               -- AI-generated doc referenced by all agents
  status              text DEFAULT 'onboarding'      -- 'onboarding' | 'active' | 'paused' | 'churned'
                      CHECK (status IN ('onboarding', 'active', 'paused', 'churned')),
  onboarded_at        timestamptz,
  created_at          timestamptz DEFAULT now() NOT NULL,
  updated_at          timestamptz DEFAULT now() NOT NULL
);

-- ── Per-client OAuth integrations ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.prymal_client_integrations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES public.prymal_clients(id) ON DELETE CASCADE,
  provider    text NOT NULL,   -- 'google' | 'instagram' | 'facebook' | 'linkedin' | 'tiktok' | 'slack' | 'notion' | 'twilio_subaccount'
  config      jsonb NOT NULL DEFAULT '{}',   -- {access_token, refresh_token, expires_at, scopes, ...}
  connected   boolean DEFAULT true,
  connected_at timestamptz DEFAULT now(),
  error_at    timestamptz,
  error_msg   text,
  UNIQUE (client_id, provider)
);

-- ── Approval queue ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prymal_approval_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES public.prymal_clients(id) ON DELETE CASCADE,
  agent           text NOT NULL,       -- 'brand' | 'outreach' | 'service' | 'ops'
  action_type     text NOT NULL,       -- 'send_email' | 'publish_post' | 'send_dm' | 'send_sms'
  action_summary  text NOT NULL,       -- human-readable 1-line description
  action_payload  jsonb NOT NULL,      -- full payload to execute if approved
  draft_content   text NOT NULL,       -- the actual content for owner to review/edit
  status          text DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'edited', 'rejected', 'executing', 'executed', 'failed', 'expired')),
  owner_edit      text,                -- set when status = 'edited'
  notified_at     timestamptz,         -- when we first sent the approval request
  renotified_at   timestamptz,         -- set if we sent the 4-hour re-notification
  resolved_at     timestamptz,
  executed_at     timestamptz,
  error_msg       text,
  delivery_token  text UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),  -- for one-click approve links
  created_at      timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approval_queue_client_status ON public.prymal_approval_queue (client_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_queue_token ON public.prymal_approval_queue (delivery_token);

-- ── Inbound messages (email, DM, SMS, chat) ───────────────────
CREATE TABLE IF NOT EXISTS public.prymal_inbound_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES public.prymal_clients(id) ON DELETE CASCADE,
  channel     text NOT NULL,      -- 'email' | 'sms' | 'instagram_dm' | 'facebook_dm' | 'chat' | 'gmb'
  from_name   text,
  from_addr   text,               -- email address, phone number, or platform user id
  subject     text,
  body        text NOT NULL,
  platform_id text,               -- platform-native message id for dedup
  status      text DEFAULT 'pending'
              CHECK (status IN ('pending', 'drafted', 'sent', 'ignored')),
  draft_id    uuid REFERENCES public.prymal_approval_queue(id),
  received_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (client_id, channel, platform_id)
);
CREATE INDEX IF NOT EXISTS idx_inbound_client_status ON public.prymal_inbound_messages (client_id, status, received_at DESC);

-- ── Social posts ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prymal_social_posts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES public.prymal_clients(id) ON DELETE CASCADE,
  platform      text NOT NULL,    -- 'instagram' | 'facebook' | 'linkedin' | 'tiktok'
  caption       text NOT NULL,
  hashtags      text[],
  media_urls    text[] DEFAULT '{}',
  status        text DEFAULT 'draft'
                CHECK (status IN ('draft', 'pending_approval', 'approved', 'scheduled', 'published', 'failed', 'rejected')),
  scheduled_at  timestamptz,
  published_at  timestamptz,
  platform_post_id text,
  approval_id   uuid REFERENCES public.prymal_approval_queue(id),
  created_at    timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_posts_client ON public.prymal_social_posts (client_id, status, scheduled_at ASC);

-- ── Contacts / leads ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prymal_contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES public.prymal_clients(id) ON DELETE CASCADE,
  name          text NOT NULL,
  email         text,
  phone         text,
  company       text,
  title         text,
  source        text,             -- 'outreach' | 'inbound' | 'manual' | 'lead_gen'
  status        text DEFAULT 'new',
  notes         text,
  last_contact  timestamptz,
  created_at    timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_client ON public.prymal_contacts (client_id, created_at DESC);

-- ── Intelligence briefings ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prymal_intel_briefings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES public.prymal_clients(id) ON DELETE CASCADE,
  week_of       date NOT NULL,
  briefing_text text NOT NULL,
  flags         text[] DEFAULT '{}',
  raw_data      jsonb DEFAULT '{}',
  delivered_via text[],
  created_at    timestamptz DEFAULT now() NOT NULL,
  UNIQUE (client_id, week_of)
);

-- ── Outreach sequences ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prymal_outreach_sequences (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES public.prymal_clients(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES public.prymal_contacts(id) ON DELETE CASCADE,
  step        int NOT NULL DEFAULT 1,     -- which step in the sequence
  channel     text NOT NULL DEFAULT 'email',
  status      text DEFAULT 'pending'
              CHECK (status IN ('pending', 'pending_approval', 'sent', 'replied', 'skipped', 'bounced')),
  draft       text NOT NULL,
  sent_at     timestamptz,
  replied_at  timestamptz,
  next_step_at timestamptz,
  approval_id uuid REFERENCES public.prymal_approval_queue(id),
  created_at  timestamptz DEFAULT now() NOT NULL
);

-- ── pg_cron schedule for weekly briefings ─────────────────────
-- Run this separately after enabling pg_cron extension:
-- SELECT cron.schedule(
--   'prymal-intel-weekly',
--   '0 13 * * 1',  -- Every Monday at 13:00 UTC (8am US Eastern, 9am Central, 10am Mountain, 11am Pacific)
--   $$
--   SELECT net.http_post(
--     url := 'https://fjkkcrmhptrzobajjsqg.supabase.co/functions/v1/prymal-intel-agent',
--     body := '{"trigger":"cron"}'::jsonb,
--     headers := '{"Content-Type":"application/json","Authorization":"Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
--   );
--   $$
-- );
