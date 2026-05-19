-- ============================================================
-- MAVIS BACKEND SQL — Run in Supabase SQL Editor
-- All 4 migrations from the current development session.
-- Safe to run in order. All statements use IF NOT EXISTS /
-- CREATE OR REPLACE so re-running is idempotent.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- MIGRATION 1 — Tool Registry, Automation Rules, Agent
--               Sessions, Distillation Jobs
-- ════════════════════════════════════════════════════════════

-- ── Dynamic Tool Registry ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mavis_tool_registry (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                text        NOT NULL,
  description         text        NOT NULL,
  category            text        NOT NULL DEFAULT 'general'
                                  CHECK (category IN ('api','system','data','analysis',
                                         'communication','trading','knowledge','general')),
  parameters          jsonb       NOT NULL DEFAULT '{}',
  returns             jsonb       DEFAULT '{}',
  enabled             boolean     NOT NULL DEFAULT true,
  requires_approval   boolean     NOT NULL DEFAULT false,
  timeout_ms          int         DEFAULT 30000,
  usage_count         int         DEFAULT 0,
  last_used_at        timestamptz,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  UNIQUE (user_id, name)
);

ALTER TABLE public.mavis_tool_registry ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mavis_tool_registry' AND policyname = 'Users manage own tools'
  ) THEN
    CREATE POLICY "Users manage own tools"
      ON public.mavis_tool_registry FOR ALL
      USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tool_registry_category
  ON public.mavis_tool_registry(category, enabled);


-- ── Automation Rules ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mavis_automation_rules (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                text        NOT NULL,
  description         text,
  trigger_event       text        NOT NULL,
  trigger_config      jsonb       DEFAULT '{}',
  condition_expr      text,
  action_type         text        NOT NULL
                                  CHECK (action_type IN (
                                    'send_agent_message','invoke_skill','invoke_plugin_action',
                                    'store_memory','run_distillation','notify_operator','custom'
                                  )),
  action_config       jsonb       NOT NULL DEFAULT '{}',
  enabled             boolean     NOT NULL DEFAULT true,
  cooldown_ms         int         DEFAULT 300000,
  last_triggered_at   timestamptz,
  trigger_count       int         NOT NULL DEFAULT 0,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

ALTER TABLE public.mavis_automation_rules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mavis_automation_rules' AND policyname = 'Users manage own automation rules'
  ) THEN
    CREATE POLICY "Users manage own automation rules"
      ON public.mavis_automation_rules FOR ALL
      USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_automation_rules_event
  ON public.mavis_automation_rules(trigger_event, enabled);


-- ── Ephemeral Agent Sessions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mavis_agent_sessions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id        text        NOT NULL,
  agent_name      text        NOT NULL,
  agent_type      text        NOT NULL DEFAULT 'ephemeral'
                              CHECK (agent_type IN ('council','persona','plugin','mavis','ephemeral')),
  task            text        NOT NULL,
  goal            text,
  sub_tasks       jsonb       DEFAULT '[]',
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','completed','failed','cancelled')),
  result          text,
  error_msg       text,
  tools_used      text[]      DEFAULT '{}',
  memory_ids      uuid[]      DEFAULT '{}',
  llm_calls       int         DEFAULT 0,
  tokens_used     int         DEFAULT 0,
  started_at      timestamptz DEFAULT now(),
  completed_at    timestamptz
);

ALTER TABLE public.mavis_agent_sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mavis_agent_sessions' AND policyname = 'Users manage own agent sessions'
  ) THEN
    CREATE POLICY "Users manage own agent sessions"
      ON public.mavis_agent_sessions FOR ALL
      USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_sessions_status
  ON public.mavis_agent_sessions(status, started_at DESC);


-- ── Distillation Jobs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mavis_distillation_jobs (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  triggered_by          text        DEFAULT 'manual',
  source_types          text[]      NOT NULL,
  source_filter         jsonb       DEFAULT '{}',
  status                text        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending','running','complete','failed')),
  input_count           int         DEFAULT 0,
  chunk_count           int         DEFAULT 0,
  output_count          int         DEFAULT 0,
  output_summary        text,
  compression_ratio     float,
  distilled_memory_ids  uuid[]      DEFAULT '{}',
  started_at            timestamptz,
  completed_at          timestamptz,
  error_msg             text,
  created_at            timestamptz DEFAULT now()
);

ALTER TABLE public.mavis_distillation_jobs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mavis_distillation_jobs' AND policyname = 'Users manage own distillation jobs'
  ) THEN
    CREATE POLICY "Users manage own distillation jobs"
      ON public.mavis_distillation_jobs FOR ALL
      USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_distillation_jobs_status
  ON public.mavis_distillation_jobs(status, created_at DESC);


-- ════════════════════════════════════════════════════════════
-- MIGRATION 2 — MCP Server Registry, Workspace Sessions,
--               Browser Snapshot Cache
-- ════════════════════════════════════════════════════════════

-- ── MCP Server Registry ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mavis_mcp_servers (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                text        NOT NULL,
  description         text,
  transport           text        NOT NULL DEFAULT 'http'
                                  CHECK (transport IN ('http','sse','stdio-proxy')),
  endpoint_url        text,
  command             text,
  args                text[]      DEFAULT '{}',
  env                 jsonb       DEFAULT '{}',
  auth_token          text,
  enabled             boolean     NOT NULL DEFAULT true,
  last_health_at      timestamptz,
  health_status       text        DEFAULT 'unknown'
                                  CHECK (health_status IN ('healthy','degraded','offline','unknown')),
  tools_manifest      jsonb       DEFAULT '[]',
  resources_manifest  jsonb       DEFAULT '[]',
  server_info         jsonb       DEFAULT '{}',
  tools_count         int         DEFAULT 0,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  UNIQUE (user_id, name)
);

ALTER TABLE public.mavis_mcp_servers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mavis_mcp_servers' AND policyname = 'Users manage own MCP servers'
  ) THEN
    CREATE POLICY "Users manage own MCP servers"
      ON public.mavis_mcp_servers FOR ALL
      USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled
  ON public.mavis_mcp_servers(user_id, enabled);


-- ── Workspace Execution Sessions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mavis_workspace_sessions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_name    text        NOT NULL,
  workspace_path  text,
  agents          jsonb       DEFAULT '[]',
  active_agent_id text,
  terminal_policy text        NOT NULL DEFAULT 'request_review'
                              CHECK (terminal_policy IN ('allow_all','request_review','deny')),
  file_policy     text        NOT NULL DEFAULT 'allow_read'
                              CHECK (file_policy IN ('allow_all','allow_read','deny')),
  browser_policy  text        NOT NULL DEFAULT 'allow_all'
                              CHECK (browser_policy IN ('allow_all','headless_only','deny')),
  pending_ops     jsonb       DEFAULT '[]',
  completed_ops   jsonb       DEFAULT '[]',
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','paused','completed','failed')),
  summary         text,
  mcp_server_ids  uuid[]      DEFAULT '{}',
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  completed_at    timestamptz
);

ALTER TABLE public.mavis_workspace_sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mavis_workspace_sessions' AND policyname = 'Users manage own workspace sessions'
  ) THEN
    CREATE POLICY "Users manage own workspace sessions"
      ON public.mavis_workspace_sessions FOR ALL
      USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workspace_sessions_status
  ON public.mavis_workspace_sessions(status, created_at DESC);


-- ── Browser Snapshot Cache ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mavis_browser_snapshots (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url             text        NOT NULL,
  final_url       text,
  title           text,
  content_text    text,
  content_length  int,
  links           jsonb       DEFAULT '[]',
  metadata        jsonb       DEFAULT '{}',
  fetch_method    text        DEFAULT 'jina',
  status_code     int,
  ttl_seconds     int         DEFAULT 3600,
  fetched_at      timestamptz DEFAULT now(),
  UNIQUE (user_id, url)
);

ALTER TABLE public.mavis_browser_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mavis_browser_snapshots' AND policyname = 'Users manage own browser snapshots'
  ) THEN
    CREATE POLICY "Users manage own browser snapshots"
      ON public.mavis_browser_snapshots FOR ALL
      USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_browser_snapshots_url
  ON public.mavis_browser_snapshots(user_id, url, fetched_at DESC);

CREATE OR REPLACE FUNCTION public.expire_browser_snapshots()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM public.mavis_browser_snapshots
  WHERE fetched_at + (ttl_seconds * interval '1 second') < now();
$$;


-- ════════════════════════════════════════════════════════════
-- MIGRATION 3 — TouchDesigner + MediaPipe Integration
-- ════════════════════════════════════════════════════════════

-- ── Gesture event log ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mavis_gesture_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source          text        NOT NULL DEFAULT 'mediapipe'
                              CHECK (source IN ('mediapipe','touchdesigner','osc')),
  gesture         text        NOT NULL,
  confidence      float       DEFAULT 1.0,
  hand            text,
  sensor_type     text        NOT NULL DEFAULT 'gesture'
                              CHECK (sensor_type IN ('gesture','face','pose','custom')),
  action_triggered text,
  payload         jsonb       DEFAULT '{}',
  detected_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mavis_gesture_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mavis_gesture_events' AND policyname = 'Users manage own gesture events'
  ) THEN
    CREATE POLICY "Users manage own gesture events"
      ON public.mavis_gesture_events FOR ALL
      USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_gesture_events_user_time
  ON public.mavis_gesture_events(user_id, detected_at DESC);


-- ── Biometric state (latest snapshot, one row per user) ──────────────────────
CREATE TABLE IF NOT EXISTS public.mavis_biometric_state (
  user_id         uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  face_present    boolean     DEFAULT false,
  face_count      int         DEFAULT 0,
  proximity       text        DEFAULT 'unknown'
                              CHECK (proximity IN ('close','medium','far','absent','unknown')),
  expression      text        DEFAULT 'neutral'
                              CHECK (expression IN ('neutral','happy','focused','tired','surprised','unknown')),
  expression_confidence float DEFAULT 0,
  pose_detected   boolean     DEFAULT false,
  engagement      text        DEFAULT 'unknown'
                              CHECK (engagement IN ('engaged','distracted','away','resting','unknown')),
  last_gesture    text,
  last_gesture_at timestamptz,
  last_gesture_confidence float DEFAULT 0,
  session_gesture_count int   DEFAULT 0,
  tracking_started_at   timestamptz,
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.mavis_biometric_state ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mavis_biometric_state' AND policyname = 'Users manage own biometric state'
  ) THEN
    CREATE POLICY "Users manage own biometric state"
      ON public.mavis_biometric_state FOR ALL
      USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;


-- ── TouchDesigner connection registry ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mavis_td_connections (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text        NOT NULL DEFAULT 'TouchDesigner',
  ws_host         text        NOT NULL DEFAULT 'localhost',
  ws_port         int         NOT NULL DEFAULT 9980,
  ws_path         text        DEFAULT '/',
  ws_enabled      boolean     DEFAULT true,
  osc_enabled     boolean     DEFAULT false,
  osc_port        int         DEFAULT 7000,
  output_topics   text[]      DEFAULT '{"agent_state","voice_active","gesture_ack"}',
  auth_token      text,
  last_connected_at timestamptz,
  health_status   text        DEFAULT 'unknown'
                              CHECK (health_status IN ('connected','disconnected','error','unknown')),
  enabled         boolean     DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (user_id, name)
);

ALTER TABLE public.mavis_td_connections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mavis_td_connections' AND policyname = 'Users manage own TD connections'
  ) THEN
    CREATE POLICY "Users manage own TD connections"
      ON public.mavis_td_connections FOR ALL
      USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;


-- ── Gesture command mappings ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mavis_gesture_commands (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gesture         text        NOT NULL,
  hold_ms         int         DEFAULT 0,
  action          text        NOT NULL,
  action_payload  jsonb       DEFAULT '{}',
  description     text,
  enabled         boolean     DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  UNIQUE (user_id, gesture)
);

ALTER TABLE public.mavis_gesture_commands ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mavis_gesture_commands' AND policyname = 'Users manage own gesture commands'
  ) THEN
    CREATE POLICY "Users manage own gesture commands"
      ON public.mavis_gesture_commands FOR ALL
      USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.prune_gesture_events(p_user_id uuid)
RETURNS void LANGUAGE sql AS $$
  DELETE FROM public.mavis_gesture_events
  WHERE user_id = p_user_id
    AND id NOT IN (
      SELECT id FROM public.mavis_gesture_events
      WHERE user_id = p_user_id
      ORDER BY detected_at DESC
      LIMIT 500
    );
$$;


-- ════════════════════════════════════════════════════════════
-- MIGRATION 4 — Standing Orders, Revenue View,
--               Note Wikilink Index, Skill Keywords Guard
-- ════════════════════════════════════════════════════════════

-- ── Standing orders (persists custom directives across sessions) ──────────────
CREATE TABLE IF NOT EXISTS public.mavis_standing_orders (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_text  text        NOT NULL,
  enabled     boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, order_text)
);

ALTER TABLE public.mavis_standing_orders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mavis_standing_orders' AND policyname = 'Users manage own standing orders'
  ) THEN
    CREATE POLICY "Users manage own standing orders"
      ON public.mavis_standing_orders FOR ALL
      USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_standing_orders_user
  ON public.mavis_standing_orders (user_id, enabled);


-- ── Revenue unification view ──────────────────────────────────────────────────
-- Merges mavis_revenue (direct events) and mavis_products (published listings).
-- Columns: id, user_id, source, amount (numeric), currency, description,
--          stripe_payment_id, metadata (jsonb), created_at

CREATE OR REPLACE VIEW public.mavis_revenue_unified AS
  SELECT
    id,
    user_id,
    source,
    amount,
    COALESCE(currency, 'usd') AS currency,
    description,
    stripe_payment_id,
    NULL::jsonb               AS metadata,
    created_at
  FROM public.mavis_revenue

  UNION ALL

  SELECT
    p.id,
    p.user_id,
    'product'                                                         AS source,
    (p.price_cents / 100.0)::numeric                                  AS amount,
    'usd'                                                             AS currency,
    p.title                                                           AS description,
    p.stripe_price_id                                                 AS stripe_payment_id,
    jsonb_build_object(
      'product_id',  p.id,
      'gumroad_url', p.gumroad_url,
      'sales_count', p.sales_count
    )                                                                 AS metadata,
    p.created_at
  FROM public.mavis_products p
  WHERE p.status = 'published'
    AND NOT EXISTS (
      SELECT 1 FROM public.mavis_revenue r
      WHERE r.user_id = p.user_id
        AND r.description = p.title
    );


-- ── Note wikilink index ───────────────────────────────────────────────────────
-- Stores [[wikilink]] slug references extracted from notes.
-- Separate from the existing mavis_note_links table (which uses resolved UUID FKs).

CREATE TABLE IF NOT EXISTS public.mavis_note_wikilinks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_note_id  uuid        NOT NULL REFERENCES public.mavis_notes(id) ON DELETE CASCADE,
  target_slug     text        NOT NULL,  -- lowercased [[wikilink]] text
  link_text       text,                  -- original casing
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_note_id, target_slug)
);

ALTER TABLE public.mavis_note_wikilinks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mavis_note_wikilinks' AND policyname = 'Users manage own note wikilinks'
  ) THEN
    CREATE POLICY "Users manage own note wikilinks"
      ON public.mavis_note_wikilinks FOR ALL
      USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_note_wikilinks_source
  ON public.mavis_note_wikilinks (user_id, source_note_id);

CREATE INDEX IF NOT EXISTS idx_note_wikilinks_target
  ON public.mavis_note_wikilinks (user_id, target_slug);


-- ── Skill definitions — ensure keywords column exists ─────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'mavis_skill_definitions'
      AND column_name = 'keywords'
  ) THEN
    ALTER TABLE public.mavis_skill_definitions
      ADD COLUMN keywords text[] NOT NULL DEFAULT '{}';
  END IF;
END $$;


-- ── updated_at auto-trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_standing_orders_updated_at'
  ) THEN
    CREATE TRIGGER trg_standing_orders_updated_at
      BEFORE UPDATE ON public.mavis_standing_orders
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;
