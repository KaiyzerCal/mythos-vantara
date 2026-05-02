-- ── MAVIS Actions Table ──────────────────────────────────────────────────────
-- Stores all tasks routed from LINDA → MAVIS for intent classification and
-- decision-making. The mavis-ingest Edge Function writes into this table.

CREATE TABLE IF NOT EXISTS mavis_actions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source        TEXT        NOT NULL,      -- "LINDA", "USER", "SYSTEM"
  task_type     TEXT        NOT NULL,      -- "content-factory", "persona-create", "decision", etc.
  payload       JSONB,                     -- full task data
  status        TEXT        NOT NULL DEFAULT 'pending',  -- pending | processing | complete | error
  mavis_response JSONB,                    -- MAVIS decision / result
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mavis_actions_status  ON mavis_actions(status);
CREATE INDEX IF NOT EXISTS idx_mavis_actions_source  ON mavis_actions(source);
CREATE INDEX IF NOT EXISTS idx_mavis_actions_created ON mavis_actions(created_at DESC);

ALTER TABLE mavis_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own actions"
  ON mavis_actions FOR SELECT
  USING (auth.uid()::text = payload->>'user_id' OR source = 'LINDA');

CREATE POLICY "Service role can insert"
  ON mavis_actions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can update"
  ON mavis_actions FOR UPDATE
  USING (true);
