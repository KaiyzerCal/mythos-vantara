-- ── mavis_function_health ─────────────────────────────────────────────────────
-- Unified heartbeat table. Each background function upserts here on start/end.
-- mavis-health-monitor checks this table hourly and alerts on stale/errored fns.
CREATE TABLE IF NOT EXISTS mavis_function_health (
  function_name         TEXT PRIMARY KEY,
  last_started_at       TIMESTAMPTZ,
  last_completed_at     TIMESTAMPTZ,
  last_status           TEXT DEFAULT 'unknown', -- 'running' | 'ok' | 'error'
  last_error            TEXT,
  run_count             INTEGER DEFAULT 0,
  error_count           INTEGER DEFAULT 0,
  expected_interval_min INTEGER NOT NULL DEFAULT 60,
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ── mavis_behavioral_signals ──────────────────────────────────────────────────
-- Raw behavioral events: tool calls, action approvals/rejections, messages.
-- mavis-learning-engine aggregates these daily to learn operator patterns.
CREATE TABLE IF NOT EXISTS mavis_behavioral_signals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  signal_type  TEXT NOT NULL,
  -- 'tool_used' | 'action_approved' | 'action_rejected' | 'action_executed'
  -- | 'message_received'
  action_type  TEXT,   -- for action_* signals
  tool_name    TEXT,   -- for tool_used signals
  outcome      TEXT,   -- 'success' | 'failure'
  hour_of_day  SMALLINT, -- 0-23 UTC
  day_of_week  SMALLINT, -- 0=Sunday
  metadata     JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bsig_user_type_created
  ON mavis_behavioral_signals(user_id, signal_type, created_at DESC);

-- ── mavis_learned_preferences ─────────────────────────────────────────────────
-- Aggregated behavioral patterns. Updated daily by mavis-learning-engine.
-- Read by mavis-agent at request time for behavioral context injection.
CREATE TABLE IF NOT EXISTS mavis_learned_preferences (
  user_id         UUID NOT NULL,
  preference_type TEXT NOT NULL,
  -- 'active_hours' | 'action_approval_rate' | 'tool_frequency' | 'auto_upgraded_action'
  key             TEXT NOT NULL,
  value           JSONB NOT NULL,
  confidence      FLOAT DEFAULT 0.5,
  sample_size     INTEGER DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, preference_type, key)
);

-- ── Cron: register health-monitor (hourly) and learning-engine (daily midnight)
INSERT INTO mavis_cron_config (job_name, schedule, edge_function, enabled)
VALUES
  ('mavis-health-monitor',   '0 * * * *',   'mavis-health-monitor',   true),
  ('mavis-learning-engine',  '0 0 * * *',   'mavis-learning-engine',  true)
ON CONFLICT (job_name) DO UPDATE
  SET schedule = EXCLUDED.schedule, edge_function = EXCLUDED.edge_function, enabled = true;
