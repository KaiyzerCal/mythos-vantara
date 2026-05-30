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
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
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
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
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
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
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
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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
