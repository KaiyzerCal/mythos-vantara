-- RuView WiFi CSI sensor state — one row per user, upserted on each event
CREATE TABLE IF NOT EXISTS mavis_ruview_state (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             uuid        REFERENCES auth.users NOT NULL UNIQUE,
  -- Presence
  present             boolean,
  n_persons           integer,
  presence_confidence float,
  room_id             text,
  -- Vitals
  heart_rate_bpm      float,
  breathing_rate_bpm  float,
  hrv_ms              float,
  stress_score        float,       -- 0.0–1.0
  -- Sleep
  sleep_stage         text,        -- awake/light/deep/rem
  apnea_events        integer,
  -- Activity
  pose_confidence     float,
  fall_detected       boolean DEFAULT false,
  last_fall_at        timestamptz,
  -- Meta
  node_id             text,
  updated_at          timestamptz DEFAULT now()
);

ALTER TABLE mavis_ruview_state ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users manage own ruview state"
    ON mavis_ruview_state FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Auto-update updated_at on every UPDATE
CREATE OR REPLACE FUNCTION set_ruview_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ruview_updated_at ON mavis_ruview_state;
CREATE TRIGGER trg_ruview_updated_at
  BEFORE UPDATE ON mavis_ruview_state
  FOR EACH ROW EXECUTE FUNCTION set_ruview_updated_at();
