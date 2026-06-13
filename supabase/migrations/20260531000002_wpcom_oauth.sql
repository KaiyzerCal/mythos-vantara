-- Add WordPress.com OAuth columns to wp_credentials
-- Make auth columns nullable so OAuth records don't need username/password
ALTER TABLE wp_credentials
  ALTER COLUMN site_url DROP NOT NULL,
  ALTER COLUMN wp_username DROP NOT NULL,
  ALTER COLUMN app_password DROP NOT NULL;

ALTER TABLE wp_credentials
  ADD COLUMN IF NOT EXISTS auth_type text DEFAULT 'app_password',
  ADD COLUMN IF NOT EXISTS wpcom_access_token text,
  ADD COLUMN IF NOT EXISTS wpcom_blog_id bigint,
  ADD COLUMN IF NOT EXISTS wpcom_site_domain text;

-- Partial unique index: one credential per project
CREATE UNIQUE INDEX IF NOT EXISTS wp_credentials_project_unique
  ON wp_credentials (project_id) WHERE project_id IS NOT NULL;
