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
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE INDEX idx_whoop_user_date ON whoop_daily_data(user_id, date DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

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
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE INDEX idx_ring_user_date ON galaxy_ring_daily_data(user_id, date DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

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
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
