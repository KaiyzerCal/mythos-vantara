-- Plugin System, Inter-Agent A2A Bus, and Agent Memory Engine
-- Adapts ElizaOS plugin registry, Moltbook message envelope, and
-- Obsidian-style persistent memory to the existing MAVIS DB schema.

-- ── Plugin registry ───────────────────────────────────────────
-- Stores installed plugins with their manifests, capability declarations,
-- and enable/disable state. Mirrors ElizaOS Character plugin array
-- but persisted in DB so they survive deploys.
CREATE TABLE IF NOT EXISTS public.mavis_plugins (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  version         text        NOT NULL DEFAULT '0.1.0',
  description     text        NOT NULL,
  author          text,
  manifest        jsonb       NOT NULL DEFAULT '{}',  -- Full plugin manifest JSON
  capabilities    text[]      DEFAULT '{}',           -- e.g. ["inference","tool","analysis"]
  required_scopes text[]      DEFAULT '{}',           -- data access scopes needed
  enabled         boolean     NOT NULL DEFAULT true,
  config          jsonb       DEFAULT '{}',           -- User-supplied config (API keys, etc.)
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (user_id, name)
);

ALTER TABLE public.mavis_plugins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own plugins"
  ON public.mavis_plugins FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── A2A inter-agent message bus ───────────────────────────────
-- Moltbook-style message envelope for agent-to-agent communication.
-- Agents poll this table via their AgentInbox or subscribe via Realtime.
-- Uses Moltbook's intent vocabulary + A2A Protocol v0.3 envelope fields.
CREATE TABLE IF NOT EXISTS public.mavis_agent_messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Sender (Moltbook sender object)
  from_agent_id   text        NOT NULL,   -- council/{id}, persona/{id}, plugin/{name}, mavis
  from_agent_name text        NOT NULL,
  from_agent_type text        NOT NULL,   -- council | persona | plugin | mavis
  from_karma      int         DEFAULT 0,  -- Moltbook reputation score

  -- Recipient
  to_agent_id     text        NOT NULL,   -- same format as from_agent_id
  to_agent_name   text,

  -- Payload (Moltbook + A2A Protocol)
  intent          text        NOT NULL CHECK (intent IN ('REQUEST','RESPONSE','BROADCAST','HEARTBEAT','SIGNAL','VOTE','DELEGATE')),
  content         text        NOT NULL,
  payload         jsonb       DEFAULT '{}',          -- Structured data beyond text
  correlation_id  uuid,                              -- Links request → response pairs
  priority        text        DEFAULT 'normal' CHECK (priority IN ('critical','high','normal','background')),
  ttl_ms          int         DEFAULT 300000,         -- 5 min default TTL

  -- Delivery tracking
  delivered       boolean     DEFAULT false,
  read            boolean     DEFAULT false,
  ack             boolean     DEFAULT false,

  created_at      timestamptz DEFAULT now(),
  expires_at      timestamptz GENERATED ALWAYS AS (created_at + (ttl_ms * interval '1 millisecond')) STORED
);

ALTER TABLE public.mavis_agent_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own agent messages"
  ON public.mavis_agent_messages FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_agent_messages_to_agent
  ON public.mavis_agent_messages(to_agent_id, delivered, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_messages_correlation
  ON public.mavis_agent_messages(correlation_id) WHERE correlation_id IS NOT NULL;

-- ── Unified agent memory (Obsidian-pattern) ───────────────────
-- One memory record per "experience", "fact", "pattern", "relationship", or "decision".
-- Frontmatter fields mirror obsidian-mind's schema.
-- Supplements (not replaces) mavis_council_memory and persona_memories.
-- All agent types write here; semantic search via existing pgvector extension.
CREATE TABLE IF NOT EXISTS public.mavis_agent_memories (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Obsidian-style identity fields (frontmatter equivalents)
  agent_id        text        NOT NULL,   -- council/{id} | persona/{id} | plugin/{name} | mavis
  agent_name      text        NOT NULL,
  agent_type      text        NOT NULL CHECK (agent_type IN ('council','persona','plugin','mavis')),

  entity_type     text        NOT NULL CHECK (entity_type IN ('experience','fact','pattern','relationship','decision','signal')),
  memory_type     text        NOT NULL CHECK (memory_type IN ('episodic','semantic','procedural','working')),
  content         text        NOT NULL,
  summary         text,                  -- Compressed version for prompt injection
  tags            text[]      DEFAULT '{}',
  wikilinks       text[]      DEFAULT '{}',  -- [[entity]] references (Obsidian-style links)
  importance      int         DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  confidence      int         DEFAULT 7 CHECK (confidence BETWEEN 1 AND 10),

  -- Source tracing
  source_session  text,                  -- mavis_memory session_id that generated this
  source_date     date        DEFAULT CURRENT_DATE,

  -- Spaced repetition (obsidian-mind pattern)
  next_review_at  timestamptz,
  review_count    int         DEFAULT 0,
  ease_factor     float       DEFAULT 2.5,  -- SM-2 algorithm ease

  -- Vector embedding for semantic recall
  embedding       vector(1536),

  -- Status
  status          text        DEFAULT 'active' CHECK (status IN ('active','archived','superseded')),
  superseded_by   uuid        REFERENCES public.mavis_agent_memories(id),

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.mavis_agent_memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own agent memories"
  ON public.mavis_agent_memories FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_agent_memories_agent
  ON public.mavis_agent_memories(agent_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_memories_type
  ON public.mavis_agent_memories(agent_type, entity_type, importance DESC);

-- Semantic recall function (mirrors match_council_memory)
CREATE OR REPLACE FUNCTION match_agent_memory(
  query_embedding  vector(1536),
  match_agent_id   text,
  match_threshold  float   DEFAULT 0.40,
  match_count      int     DEFAULT 8
)
RETURNS TABLE (
  id          uuid,
  content     text,
  summary     text,
  entity_type text,
  memory_type text,
  tags        text[],
  importance  int,
  created_at  timestamptz,
  similarity  float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id, content, summary, entity_type, memory_type, tags, importance, created_at,
    1 - (embedding <=> query_embedding) AS similarity
  FROM public.mavis_agent_memories
  WHERE agent_id = match_agent_id
    AND status = 'active'
    AND embedding IS NOT NULL
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
$$;

-- ── Agent karma/reputation (Moltbook MolTrust pattern) ────────
-- Tracks agent contribution quality scores for message priority routing.
CREATE TABLE IF NOT EXISTS public.mavis_agent_karma (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id    text NOT NULL,
  agent_name  text NOT NULL,
  karma       int  NOT NULL DEFAULT 0,
  signals     int  NOT NULL DEFAULT 0,  -- Number of SIGNAL messages sent
  responses   int  NOT NULL DEFAULT 0,  -- Responses sent
  accuracy    float DEFAULT 0.5,        -- Accuracy of predictions/recommendations
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, agent_id)
);

ALTER TABLE public.mavis_agent_karma ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own agent karma"
  ON public.mavis_agent_karma FOR ALL USING (auth.uid() = user_id);

-- ── Plugin execution log ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mavis_plugin_executions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plugin_name   text        NOT NULL,
  action_name   text        NOT NULL,
  input         text,
  output        text,
  success       boolean     NOT NULL DEFAULT true,
  error_msg     text,
  duration_ms   int,
  tokens_used   int,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.mavis_plugin_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own plugin executions"
  ON public.mavis_plugin_executions FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_plugin_executions_plugin
  ON public.mavis_plugin_executions(plugin_name, created_at DESC);
