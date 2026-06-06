-- ============================================================
-- MAVIS Autonomous Scheduling — pg_cron + pg_net infrastructure
-- Enables MAVIS to run itself without external triggers
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Log table for all autonomous runs
CREATE TABLE IF NOT EXISTS mavis_autonomous_runs (
  id            BIGSERIAL PRIMARY KEY,
  job_name      TEXT        NOT NULL,
  triggered_at  TIMESTAMPTZ DEFAULT NOW(),
  status        TEXT        DEFAULT 'dispatched',
  response_code INTEGER,
  notes         TEXT
);

-- Config table — each row is a cron-driven MAVIS action
CREATE TABLE IF NOT EXISTS mavis_cron_config (
  id            SERIAL PRIMARY KEY,
  job_name      TEXT    NOT NULL UNIQUE,
  edge_function TEXT    NOT NULL,
  schedule      TEXT    NOT NULL,  -- cron expression
  enabled       BOOLEAN DEFAULT TRUE,
  payload       JSONB   DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the default autonomous jobs
INSERT INTO mavis_cron_config (job_name, edge_function, schedule, payload) VALUES
  ('mavis-morning-brief',       'mavis-morning-brief',       '0 7 * * *',     '{"scheduled":true}'),
  ('mavis-weekly-retro',        'mavis-weekly-retro',         '0 20 * * 0',    '{"scheduled":true}'),
  ('mavis-memory-consolidate',  'mavis-consolidate',          '0 2 * * *',     '{"scheduled":true}'),
  ('mavis-memory-embed',        'mavis-memory-embed',         '*/15 * * * *',  '{"scheduled":true}'),
  ('mavis-workflow-scheduler',  'mavis-autonomous-engine',    '*/5 * * * *',   '{"task":"run_scheduled_workflows"}'),
  ('mavis-proactive-nudge',     'mavis-proactive-nudge',      '0 */4 * * *',   '{"scheduled":true}'),
  ('mavis-goal-review',         'mavis-goal-review',          '0 21 * * *',    '{"scheduled":true}')
ON CONFLICT (job_name) DO NOTHING;

-- Helper: dispatcher SQL function called by pg_cron
-- Call mavis-cron-setup edge function once to activate — it reads this table
-- and registers all pg_cron jobs using the Supabase URL from env.
CREATE OR REPLACE FUNCTION mavis_log_cron_run(p_job_name TEXT, p_code INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO mavis_autonomous_runs (job_name, response_code, status)
  VALUES (p_job_name, p_code, CASE WHEN p_code BETWEEN 200 AND 299 THEN 'ok' ELSE 'error' END);
END;
$$;
