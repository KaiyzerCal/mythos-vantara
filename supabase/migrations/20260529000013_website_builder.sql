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
CREATE POLICY "user own clients" ON website_clients FOR ALL USING (auth.uid() = user_id);
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
CREATE POLICY "user own projects" ON website_projects FOR ALL USING (auth.uid() = user_id);
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
CREATE POLICY "user own wp creds" ON wp_credentials FOR ALL USING (auth.uid() = user_id);

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
CREATE POLICY "user own pages" ON website_pages FOR ALL USING (auth.uid() = user_id);
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
CREATE POLICY "user own jobs" ON website_generation_jobs FOR ALL USING (auth.uid() = user_id);

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
CREATE POLICY "user own tiers" ON website_service_tiers FOR ALL USING (auth.uid() = user_id);

-- Seed default service tiers (runs on first insert)
-- Users will customize these
