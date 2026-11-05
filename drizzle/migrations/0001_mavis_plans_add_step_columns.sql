SET lock_timeout = '3s';
SET statement_timeout = '60s';

-- mavis_plans was created by the earlier plan_execute migration without the
-- step-tracking columns; the later mavis_plans migration used CREATE TABLE IF
-- NOT EXISTS and was skipped. mavis-chat selects steps/current_step/
-- last_session_summary, so every plan lookup errored silently.
ALTER TABLE public.mavis_plans ADD COLUMN IF NOT EXISTS steps jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public.mavis_plans ADD COLUMN IF NOT EXISTS current_step integer DEFAULT 0;
ALTER TABLE public.mavis_plans ADD COLUMN IF NOT EXISTS last_session_summary text DEFAULT '';