-- OAuth token store for Salesforce, Google (Calendar), and future providers
-- Separate from mavis_user_integrations (which stores simple API keys)
-- because OAuth flows need access_token + refresh_token + expiry + instance_url
CREATE TABLE IF NOT EXISTS mavis_oauth_tokens (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid REFERENCES auth.users NOT NULL,
  provider     text NOT NULL,        -- 'salesforce' | 'google' | 'microsoft'
  access_token text NOT NULL,
  refresh_token text,
  instance_url text,                 -- Salesforce instance URL (e.g. https://na1.salesforce.com)
  expires_at   bigint,               -- Unix ms when access_token expires
  scope        text,
  metadata     jsonb DEFAULT '{}',
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  UNIQUE(user_id, provider)
);

ALTER TABLE mavis_oauth_tokens ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "user own oauth tokens" ON mavis_oauth_tokens
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_mavis_oauth_tokens_user ON mavis_oauth_tokens(user_id, provider);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Bookings table — stores reservations across all providers
-- (restaurants, hotels, calendar events, services)
CREATE TABLE IF NOT EXISTS mavis_bookings (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid REFERENCES auth.users NOT NULL,
  booking_type  text NOT NULL,        -- 'restaurant' | 'hotel' | 'service' | 'calendar' | 'custom'
  provider      text,                 -- 'google_calendar' | 'manual' | etc.
  external_id   text,                 -- calendar event ID or external booking reference
  title         text NOT NULL,
  description   text,
  location      text,
  start_time    timestamptz NOT NULL,
  end_time      timestamptz,
  attendees     jsonb DEFAULT '[]',   -- [{ name, email }]
  status        text DEFAULT 'confirmed',  -- pending | confirmed | cancelled
  metadata      jsonb DEFAULT '{}',
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

ALTER TABLE mavis_bookings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "user own bookings" ON mavis_bookings
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_mavis_bookings_user_time ON mavis_bookings(user_id, start_time);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_mavis_bookings_status ON mavis_bookings(user_id, status) WHERE status != 'cancelled';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
