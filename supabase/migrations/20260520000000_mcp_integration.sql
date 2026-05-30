-- MCP Integration — tool execution logging + knowledge graph traversal indexes
-- Safe to re-run: all statements use IF NOT EXISTS / OR REPLACE guards.

-- ── MCP tool execution log ────────────────────────────────────────────────────
-- Records every MAVIS tool call: what ran, how long it took, success/failure.
-- Powers the IntegrationsPage analytics and future tool-quality scoring.

CREATE TABLE IF NOT EXISTS mavis_tool_executions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_name    text NOT NULL,
  params       jsonb,
  result       jsonb,
  success      boolean NOT NULL DEFAULT true,
  error_msg    text,
  duration_ms  integer,
  provider     text,   -- "stagehand-local" | "browserbase-cloud" | "fetch-fallback" | "n8n-mcp" | "native"
  created_at   timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS mavis_tool_executions_user_idx  ON mavis_tool_executions(user_id, created_at DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS mavis_tool_executions_tool_idx  ON mavis_tool_executions(tool_name);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

ALTER TABLE mavis_tool_executions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "tool_exec_own" ON mavis_tool_executions
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Knowledge graph traversal indexes ────────────────────────────────────────
-- mavis_note_wikilinks (created via dashboard — ensure it exists)
CREATE TABLE IF NOT EXISTS mavis_note_wikilinks (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_note_id uuid        NOT NULL REFERENCES public.mavis_notes(id) ON DELETE CASCADE,
  target_slug    text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mavis_note_wikilinks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users own wikilinks" ON mavis_note_wikilinks FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS mavis_note_wikilinks_source_idx
    ON mavis_note_wikilinks(user_id, source_note_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS mavis_note_wikilinks_slug_idx
    ON mavis_note_wikilinks(user_id, lower(target_slug));
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS mavis_notes_title_lower_idx
    ON mavis_notes(user_id, lower(title));
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ── Workflow execution log ────────────────────────────────────────────────────
-- Stores n8n workflow blueprints built by MAVIS and their execution outcomes.

CREATE TABLE IF NOT EXISTS mavis_workflow_executions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workflow_name   text NOT NULL,
  n8n_workflow_id text,                        -- ID in connected n8n instance
  blueprint       jsonb,                       -- the workflow JSON MAVIS built
  trigger_data    jsonb,
  execution_id    text,                        -- n8n execution ID
  status          text NOT NULL DEFAULT 'pending',  -- pending | running | success | error
  result_data     jsonb,
  error_msg       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

ALTER TABLE mavis_workflow_executions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "workflow_exec_own" ON mavis_workflow_executions
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Sequential thought log ────────────────────────────────────────────────────
-- Stores reasoning chains MAVIS ran before complex actions.
-- Enables post-hoc auditing of why a decision was made.

CREATE TABLE IF NOT EXISTS mavis_thought_chains (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal            text NOT NULL,
  mode            text NOT NULL DEFAULT 'chain',
  steps_taken     integer NOT NULL DEFAULT 0,
  revisions_used  integer NOT NULL DEFAULT 0,
  conclusion      text,
  full_chain      jsonb,   -- serialized ThoughtChain
  triggered_by    text,    -- which tool / action requested the reasoning
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mavis_thought_chains ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "thought_chains_own" ON mavis_thought_chains
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
