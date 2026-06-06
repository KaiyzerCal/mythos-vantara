-- MAVIS Leads — AI-researched sales prospects and outreach pipeline
CREATE TABLE IF NOT EXISTS mavis_leads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  company_name text NOT NULL,
  contact_name text,
  contact_email text,
  contact_title text,
  linkedin_url text,
  website text,
  industry text,
  company_size text,
  research_summary text,
  pain_points jsonb DEFAULT '[]',
  outreach_draft text,
  status text NOT NULL DEFAULT 'researched',  -- researched | contacted | replied | qualified | closed
  score integer DEFAULT 5,  -- 1-10
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE mavis_leads ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "user own leads" ON mavis_leads FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_mavis_leads_user ON mavis_leads(user_id, created_at DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_mavis_leads_status ON mavis_leads(user_id, status);
EXCEPTION WHEN undefined_table THEN NULL; END $$;
