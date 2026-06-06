-- MAVIS Competitor tracking — monitored competitor URLs and change snapshots
CREATE TABLE IF NOT EXISTS mavis_competitors (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  name text NOT NULL,
  url text NOT NULL,
  last_content_hash text,
  last_checked_at timestamptz,
  changes_detected integer DEFAULT 0,
  snapshot jsonb DEFAULT '{}',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE mavis_competitors ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "user own competitors" ON mavis_competitors FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_mavis_competitors_user ON mavis_competitors(user_id, created_at DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_mavis_competitors_checked ON mavis_competitors(user_id, last_checked_at ASC NULLS FIRST);
EXCEPTION WHEN undefined_table THEN NULL; END $$;
