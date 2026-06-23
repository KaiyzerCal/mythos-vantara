-- Add gutenberg_html column to website_pages for storing generated HTML
ALTER TABLE website_pages ADD COLUMN IF NOT EXISTS gutenberg_html text;

-- Add missing columns to website_projects that the frontend form uses
ALTER TABLE website_projects ADD COLUMN IF NOT EXISTS client_name text;
ALTER TABLE website_projects ADD COLUMN IF NOT EXISTS pages text[];
ALTER TABLE website_projects ADD COLUMN IF NOT EXISTS wp_username text;
ALTER TABLE website_projects ADD COLUMN IF NOT EXISTS wp_app_password text;
