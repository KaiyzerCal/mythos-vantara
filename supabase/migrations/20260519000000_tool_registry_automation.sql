-- Tool Registry, Automation Rules, Ephemeral Agent Sessions, Distillation Jobs
-- Supports: OpenClaw tool orchestration, OpenJarvis event-driven automation,
-- ElizaOS dynamic agent formation, Felix AI knowledge compression.

-- ── Dynamic Tool Registry (OpenClaw pattern) ──────────────────────────────────
-- Stores registered tools with JSON Schema parameters for LLM function calling.
-- Built-in tools are registered in-memory; user-defined tools persist here.
CREATE TABLE IF NOT EXISTS public.mavis_tool_registry (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text        NOT NULL,
  category        text        NOT NULL DEFAULT 'general'
                              CHECK (category IN ('api','system','data','analysis','communication','trading','knowledge')),
  parameters      jsonb       NOT NULL DEFAULT '{}',  -- JSON Schema object
  returns         jsonb       DEFAULT '{}',           -- Return type schema
  enabled         boolean     NOT NULL DEFAULT true,
  requires_approval boolean   NOT NULL DEFAULT false,
  timeout_ms      int         DEFAULT 30000,
  usage_count     int         DEFAULT 0,
  last_used_at    timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (user_id, name)
);

ALTER TABLE public.mavis_tool_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own tools"
  ON public.mavis_tool_registry FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_tool_registry_category
  ON public.mavis_tool_registry(category, enabled);

-- ── Automation Rules (OpenJarvis event-driven pattern) ────────────────────────
-- Maps system events to MAVIS actions. Evaluates conditions client-side,
-- executes actions via the AutomationEngine.
CREATE TABLE IF NOT EXISTS public.mavis_automation_rules (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,

  -- Trigger definition
  trigger_event   text        NOT NULL,  -- 'network:offline' | 'network:online' | 'schedule:daily' |
                                         -- 'metric:threshold' | 'agent:signal' | 'custom'
  trigger_config  jsonb       DEFAULT '{}',  -- e.g. { "metric": "memory_mb", "threshold": 1024, "op": "gt" }

  -- Optional JS-safe condition expression evaluated at trigger time
  -- Variables available: event, context (AppStateSnapshot), now
  condition_expr  text,                  -- e.g. "context.energy < 30"

  -- Action to execute
  action_type     text        NOT NULL
                              CHECK (action_type IN (
                                'send_agent_message','invoke_skill','invoke_plugin_action',
                                'store_memory','run_distillation','notify_operator','custom'
                              )),
  action_config   jsonb       NOT NULL DEFAULT '{}',

  -- State
  enabled         boolean     NOT NULL DEFAULT true,
  cooldown_ms     int         DEFAULT 300000,  -- Min ms between triggers (5 min default)
  last_triggered_at timestamptz,
  trigger_count   int         NOT NULL DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.mavis_automation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own automation rules"
  ON public.mavis_automation_rules FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_automation_rules_event
  ON public.mavis_automation_rules(trigger_event, enabled);

-- ── Ephemeral Agent Sessions (ElizaOS dynamic formation) ──────────────────────
-- Tracks short-lived agents spun up for specific tasks. Cleaned up after
-- completion; learnings are stored in mavis_agent_memories before teardown.
CREATE TABLE IF NOT EXISTS public.mavis_agent_sessions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  agent_id        text        NOT NULL,  -- ephemeral/{uuid}
  agent_name      text        NOT NULL,
  agent_type      text        NOT NULL DEFAULT 'ephemeral'
                              CHECK (agent_type IN ('council','persona','plugin','mavis','ephemeral')),

  task            text        NOT NULL,  -- Original task description
  goal            text,                  -- Decomposed high-level goal
  sub_tasks       jsonb       DEFAULT '[]',  -- [{ id, description, status, result }]

  -- Lifecycle
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','completed','failed','cancelled')),
  result          text,
  error_msg       text,

  -- Resources used
  tools_used      text[]      DEFAULT '{}',
  memory_ids      uuid[]      DEFAULT '{}',
  llm_calls       int         DEFAULT 0,
  tokens_used     int         DEFAULT 0,

  started_at      timestamptz DEFAULT now(),
  completed_at    timestamptz
);

ALTER TABLE public.mavis_agent_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own agent sessions"
  ON public.mavis_agent_sessions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_status
  ON public.mavis_agent_sessions(status, started_at DESC);

-- ── Distillation Jobs (Felix AI knowledge compression) ────────────────────────
-- Tracks async knowledge compression runs. Input: raw notes/journal/messages.
-- Output: distilled semantic memories stored in mavis_agent_memories.
CREATE TABLE IF NOT EXISTS public.mavis_distillation_jobs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  triggered_by    text        DEFAULT 'manual',  -- 'manual' | 'schedule' | 'automation'

  -- Source configuration
  source_types    text[]      NOT NULL,           -- ['notes','journal','vault','messages','mixed']
  source_filter   jsonb       DEFAULT '{}',       -- { date_from, date_to, tags, min_importance }

  -- Processing state
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','running','complete','failed')),
  input_count     int         DEFAULT 0,          -- Source items processed
  chunk_count     int         DEFAULT 0,          -- Text chunks created
  output_count    int         DEFAULT 0,          -- Distilled memories stored

  -- Results
  output_summary  text,                           -- Top-level synthesis
  compression_ratio float,                        -- input tokens / output tokens
  distilled_memory_ids uuid[] DEFAULT '{}',

  -- Timing
  started_at      timestamptz,
  completed_at    timestamptz,
  error_msg       text,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE public.mavis_distillation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own distillation jobs"
  ON public.mavis_distillation_jobs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_distillation_jobs_status
  ON public.mavis_distillation_jobs(status, created_at DESC);
