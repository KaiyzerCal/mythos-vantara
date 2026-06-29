-- MCP server registry, workspace execution sessions, browser page cache
-- Supports: Antigravity MCP Client-Host-Server pattern, Agent Manager sessions,
-- browser verification snapshots.

-- ── MCP Server Registry ───────────────────────────────────────────────────────
-- Stores configured MCP servers (HTTP or stdio-proxy transport).
-- On connect, discovered tools are synced to mavis_tool_registry.
CREATE TABLE IF NOT EXISTS public.mavis_mcp_servers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,

  -- Transport config (mirrors mcp_config.json format)
  transport       text        NOT NULL DEFAULT 'http'
                              CHECK (transport IN ('http', 'sse', 'stdio-proxy')),
  endpoint_url    text,                    -- HTTP/SSE: full URL
  command         text,                    -- stdio-proxy: executable name
  args            text[]      DEFAULT '{}', -- stdio-proxy: command args
  env             jsonb       DEFAULT '{}', -- env vars for the server process

  -- Auth
  auth_token      text,                    -- Bearer token for HTTP servers

  -- State
  enabled         boolean     NOT NULL DEFAULT true,
  last_health_at  timestamptz,
  health_status   text        DEFAULT 'unknown'
                              CHECK (health_status IN ('healthy','degraded','offline','unknown')),

  -- Discovered capabilities (cached from last connect)
  tools_manifest  jsonb       DEFAULT '[]',   -- MCPTool[] from tools/list
  resources_manifest jsonb    DEFAULT '[]',   -- MCPResource[] from resources/list
  server_info     jsonb       DEFAULT '{}',   -- serverInfo from initialize response
  tools_count     int         DEFAULT 0,

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (user_id, name)
);

ALTER TABLE public.mavis_mcp_servers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own MCP servers"
  ON public.mavis_mcp_servers FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled
  ON public.mavis_mcp_servers(user_id, enabled);

-- ── Workspace Execution Sessions (Antigravity Agent Manager pattern) ──────────
-- Tracks multi-agent workspace sessions: parallel agents each with their own
-- execution context (files, terminal, browser). Mirrors Antigravity's two-window
-- architecture (Agent Manager + Editor pane).
CREATE TABLE IF NOT EXISTS public.mavis_workspace_sessions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Session identity
  session_name    text        NOT NULL,
  workspace_path  text,                    -- root dir being operated on

  -- Agent roster for this session
  agents          jsonb       DEFAULT '[]',  -- [{id, name, specialization, status}]
  active_agent_id text,                      -- currently focused agent

  -- Execution policy (Antigravity terminal autonomy model)
  terminal_policy text        NOT NULL DEFAULT 'request_review'
                              CHECK (terminal_policy IN ('allow_all','request_review','deny')),
  file_policy     text        NOT NULL DEFAULT 'allow_read'
                              CHECK (file_policy IN ('allow_all','allow_read','deny')),
  browser_policy  text        NOT NULL DEFAULT 'allow_all'
                              CHECK (browser_policy IN ('allow_all','headless_only','deny')),

  -- Queued and completed operations
  pending_ops     jsonb       DEFAULT '[]',  -- ops awaiting review
  completed_ops   jsonb       DEFAULT '[]',  -- audit log of completed ops

  -- Session state
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','paused','completed','failed')),
  summary         text,
  mcp_server_ids  uuid[]      DEFAULT '{}',  -- MCP servers available to this session

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  completed_at    timestamptz
);

ALTER TABLE public.mavis_workspace_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own workspace sessions"
  ON public.mavis_workspace_sessions FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_workspace_sessions_status
  ON public.mavis_workspace_sessions(status, created_at DESC);

-- ── Browser Snapshot Cache (Antigravity browser verification) ─────────────────
-- Caches fetched web pages for the browser agent. TTL enforced by the client.
-- Avoids redundant re-fetches during a research/verification run.
CREATE TABLE IF NOT EXISTS public.mavis_browser_snapshots (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url             text        NOT NULL,
  final_url       text,                    -- after redirects
  title           text,
  content_text    text,                    -- clean extracted text
  content_length  int,
  links           jsonb       DEFAULT '[]',  -- [{href, text}]
  metadata        jsonb       DEFAULT '{}',  -- og:*, twitter:*, description
  fetch_method    text        DEFAULT 'jina',  -- 'jina' | 'direct' | 'mcp'
  status_code     int,
  ttl_seconds     int         DEFAULT 3600,
  fetched_at      timestamptz DEFAULT now(),
  UNIQUE (user_id, url)
);

ALTER TABLE public.mavis_browser_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own browser snapshots"
  ON public.mavis_browser_snapshots FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_browser_snapshots_url
  ON public.mavis_browser_snapshots(user_id, url, fetched_at DESC);

-- Auto-expire old snapshots (cleanup function called by automation rules)
CREATE OR REPLACE FUNCTION public.expire_browser_snapshots()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM public.mavis_browser_snapshots
  WHERE fetched_at + (ttl_seconds * interval '1 second') < now();
$$;
