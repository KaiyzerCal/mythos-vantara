-- Netlify publishing fields on website_projects
ALTER TABLE website_projects
  ADD COLUMN IF NOT EXISTS netlify_site_id text,
  ADD COLUMN IF NOT EXISTS netlify_site_url text,
  ADD COLUMN IF NOT EXISTS netlify_deploy_id text,
  ADD COLUMN IF NOT EXISTS netlify_deploy_status text;
