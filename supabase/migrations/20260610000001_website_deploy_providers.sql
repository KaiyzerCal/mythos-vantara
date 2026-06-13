-- Add generic deployment columns to website_projects
-- Keeps the old netlify_* columns for backward compat; new columns are provider-agnostic.

ALTER TABLE public.website_projects
  ADD COLUMN IF NOT EXISTS deploy_provider text DEFAULT 'netlify',
  ADD COLUMN IF NOT EXISTS deploy_url       text,
  ADD COLUMN IF NOT EXISTS deploy_project_id text;

-- Backfill existing Netlify deployments into the new columns
UPDATE public.website_projects
SET
  deploy_provider    = 'netlify',
  deploy_url         = netlify_site_url,
  deploy_project_id  = netlify_site_id
WHERE netlify_site_url IS NOT NULL AND deploy_url IS NULL;
