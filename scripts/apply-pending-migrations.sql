-- Combined pending migrations (20260529 + 20260530)
-- Safe to run: all use IF NOT EXISTS / CREATE OR REPLACE

-- ============================================================
-- supabase/migrations/20260529000000_add_memory_embeddings.sql
-- ============================================================
-- Enable pgvector (safe if already enabled)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add 768-dimensional embedding column to mavis_agent_memories (Gemini text-embedding-004)
ALTER TABLE mavis_agent_memories
  ADD COLUMN IF NOT EXISTS embedding vector(768);

-- IVFFlat index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS mavis_memories_embedding_idx
  ON mavis_agent_memories
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Semantic similarity search function
CREATE OR REPLACE FUNCTION search_memories_semantic(
  query_embedding vector(768),
  match_user_id   uuid,
  match_count     int DEFAULT 6
)
RETURNS TABLE (
  id            uuid,
  content       text,
  memory_type   text,
  tags          text[],
  importance    int,
  created_at    timestamptz,
  similarity    float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    content,
    memory_type,
    tags,
    importance,
    created_at,
    1 - (embedding <=> query_embedding) AS similarity
  FROM mavis_agent_memories
  WHERE user_id = match_user_id
    AND status = 'active'
    AND embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ============================================================
-- supabase/migrations/20260529000001_hybrid_search_decay.sql
-- ============================================================
-- Hybrid search + episodic memory decay for mavis_agent_memories

-- 1. Add tsvector column for BM25-style full-text search
ALTER TABLE mavis_agent_memories
  ADD COLUMN IF NOT EXISTS fts tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS mavis_memories_fts_idx
  ON mavis_agent_memories USING gin(fts);

-- 2. Add episodic memory decay tracking columns
ALTER TABLE mavis_agent_memories
  ADD COLUMN IF NOT EXISTS last_accessed_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS access_count int DEFAULT 0 NOT NULL;

-- 3. Hybrid search function: BM25 + pgvector cosine + RRF merge + temporal decay
CREATE OR REPLACE FUNCTION search_memories_hybrid(
  query_embedding  vector(768),
  query_text       text,
  match_user_id    uuid,
  match_count      int DEFAULT 6
)
RETURNS TABLE (
  id            uuid,
  content       text,
  memory_type   text,
  tags          text[],
  importance    int,
  created_at    timestamptz,
  score         float
)
LANGUAGE sql STABLE
AS $$
  WITH semantic AS (
    SELECT id,
           row_number() OVER (ORDER BY embedding <=> query_embedding) AS rank
    FROM mavis_agent_memories
    WHERE user_id = match_user_id
      AND status  = 'active'
      AND embedding IS NOT NULL
    ORDER BY embedding <=> query_embedding
    LIMIT 20
  ),
  keyword AS (
    SELECT id,
           row_number() OVER (
             ORDER BY ts_rank_cd(fts, plainto_tsquery('english', query_text)) DESC
           ) AS rank
    FROM mavis_agent_memories
    WHERE user_id = match_user_id
      AND status  = 'active'
      AND fts @@ plainto_tsquery('english', query_text)
    ORDER BY ts_rank_cd(fts, plainto_tsquery('english', query_text)) DESC
    LIMIT 20
  ),
  rrf AS (
    SELECT coalesce(s.id, k.id) AS id,
           coalesce(1.0 / (60.0 + s.rank), 0.0) +
           coalesce(1.0 / (60.0 + k.rank), 0.0) AS rrf_score
    FROM semantic s FULL OUTER JOIN keyword k ON s.id = k.id
  )
  SELECT
    m.id,
    m.content,
    m.memory_type,
    m.tags,
    m.importance,
    m.created_at,
    -- decay: recency × engagement bonus
    r.rrf_score
      * (0.6 + 0.4 * exp(
          -extract(epoch from (now() - coalesce(m.last_accessed_at, m.created_at))) / 2592000.0
        ))
      * ln(1.0 + coalesce(m.access_count, 0))
      AS score
  FROM rrf r
  JOIN mavis_agent_memories m ON r.id = m.id
  ORDER BY score DESC
  LIMIT match_count;
$$;

-- 4. Update access tracking when a memory is retrieved
CREATE OR REPLACE FUNCTION bump_memory_access(memory_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE mavis_agent_memories
  SET last_accessed_at = now(),
      access_count     = coalesce(access_count, 0) + 1
  WHERE id = memory_id;
$$;

-- 5. Also add tsvector + decay to mavis_notes (knowledge graph) for consistency
ALTER TABLE mavis_notes
  ADD COLUMN IF NOT EXISTS fts tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS mavis_notes_fts_idx
  ON mavis_notes USING gin(fts);

ALTER TABLE mavis_notes
  ADD COLUMN IF NOT EXISTS last_accessed_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS access_count int DEFAULT 0 NOT NULL;

-- ============================================================
-- supabase/migrations/20260529000002_notification_budget.sql
-- ============================================================
-- Smart notification budget: each user gets 5 notification slots per day.
-- Notifications are deducted from the budget; highest-priority fire first.

CREATE TABLE IF NOT EXISTS notification_budget (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date         date NOT NULL DEFAULT current_date,
  slots_used   int  NOT NULL DEFAULT 0,
  slots_total  int  NOT NULL DEFAULT 5,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

ALTER TABLE notification_budget ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own budget" ON notification_budget
  FOR ALL USING (auth.uid() = user_id);

-- Notification priority log (for analytics/tuning)
CREATE TABLE IF NOT EXISTS notification_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type          text NOT NULL, -- streak_risk | deadline | energy | contract_violation | motivational
  title         text NOT NULL,
  body          text,
  priority      int  NOT NULL DEFAULT 5, -- 1 (highest) to 10 (lowest)
  sent_at       timestamptz DEFAULT now(),
  opened        boolean DEFAULT false,
  opened_at     timestamptz
);

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own log" ON notification_log
  FOR ALL USING (auth.uid() = user_id);

-- Function: consume one notification slot
-- Returns true if slot was available, false if budget exhausted
CREATE OR REPLACE FUNCTION consume_notification_slot(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_used int;
  v_total int;
BEGIN
  INSERT INTO notification_budget (user_id, date, slots_used, slots_total)
  VALUES (p_user_id, current_date, 0, 5)
  ON CONFLICT (user_id, date) DO NOTHING;

  SELECT slots_used, slots_total
  INTO v_used, v_total
  FROM notification_budget
  WHERE user_id = p_user_id AND date = current_date
  FOR UPDATE;

  IF v_used >= v_total THEN
    RETURN false;
  END IF;

  UPDATE notification_budget
  SET slots_used = slots_used + 1, updated_at = now()
  WHERE user_id = p_user_id AND date = current_date;

  RETURN true;
END;
$$;

-- ============================================================
-- supabase/migrations/20260529000003_emotion_scores.sql
-- ============================================================
-- Add structured emotion scores to journal entries
-- Uses Hume AI Expression Measurement API results (48-dim emotion vector stored as jsonb)

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS emotion_scores  jsonb,
  ADD COLUMN IF NOT EXISTS emotion_tagged  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS dominant_emotion text;

-- Index for emotion-based queries (e.g., "show me all anxious entries")
CREATE INDEX IF NOT EXISTS journal_emotion_idx
  ON journal_entries USING gin(emotion_scores);

-- Index for dominant emotion filtering
CREATE INDEX IF NOT EXISTS journal_dominant_emotion_idx
  ON journal_entries (user_id, dominant_emotion)
  WHERE dominant_emotion IS NOT NULL;

-- Emotion trend view: aggregated weekly emotion averages per user
CREATE OR REPLACE VIEW emotion_weekly_trends AS
  SELECT
    user_id,
    date_trunc('week', created_at) AS week,
    dominant_emotion,
    count(*) AS entry_count,
    avg((emotion_scores->>'determination')::float) AS avg_determination,
    avg((emotion_scores->>'anxiety')::float)       AS avg_anxiety,
    avg((emotion_scores->>'joy')::float)            AS avg_joy,
    avg((emotion_scores->>'sadness')::float)        AS avg_sadness,
    avg((emotion_scores->>'excitement')::float)     AS avg_excitement,
    avg((emotion_scores->>'tiredness')::float)      AS avg_tiredness,
    avg((emotion_scores->>'focus')::float)          AS avg_focus,
    avg((emotion_scores->>'pride')::float)          AS avg_pride,
    avg((emotion_scores->>'frustration')::float)    AS avg_frustration,
    avg((emotion_scores->>'gratitude')::float)      AS avg_gratitude
  FROM journal_entries
  WHERE emotion_scores IS NOT NULL
  GROUP BY user_id, week, dominant_emotion;

-- ============================================================
-- supabase/migrations/20260529000004_plan_execute.sql
-- ============================================================
-- Plan-and-Execute agent: stores goal DAGs decomposed by the planner

CREATE TABLE IF NOT EXISTS mavis_plans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        text NOT NULL,
  goal         text NOT NULL,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','paused','failed')),
  total_steps  int  NOT NULL DEFAULT 0,
  done_steps   int  NOT NULL DEFAULT 0,
  context      jsonb,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mavis_plan_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id      uuid NOT NULL REFERENCES mavis_plans(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  step_index   int  NOT NULL,
  title        text NOT NULL,
  description  text,
  type         text NOT NULL DEFAULT 'execute' CHECK (type IN ('research','write','execute','create_quest','notify','wait')),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','skipped')),
  depends_on   uuid[], -- IDs of steps that must complete first
  result       text,
  error        text,
  actions      jsonb, -- MAVIS actions to execute for this step
  started_at   timestamptz,
  completed_at timestamptz,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE mavis_plans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE mavis_plan_steps  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own plans"      ON mavis_plans      FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own plan steps" ON mavis_plan_steps FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS plan_steps_plan_idx   ON mavis_plan_steps (plan_id, step_index);
CREATE INDEX IF NOT EXISTS plan_steps_status_idx ON mavis_plan_steps (user_id, status);

-- ============================================================
-- supabase/migrations/20260529000005_game_master.sql
-- ============================================================
-- GAME_MASTER mode: streak insurance, consequence quests, dynamic difficulty

-- Streak insurance: allows users to protect one streak break per period
CREATE TABLE IF NOT EXISTS streak_insurance (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id      uuid REFERENCES tasks(id) ON DELETE SET NULL,
  quest_id     uuid REFERENCES quests(id) ON DELETE SET NULL,
  used_at      timestamptz,
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  status       text NOT NULL DEFAULT 'available' CHECK (status IN ('available','used','expired')),
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE streak_insurance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own insurance" ON streak_insurance
  FOR ALL USING (auth.uid() = user_id);

-- Consequence quest linking: failing a habit quest can trigger a consequence
ALTER TABLE quests
  ADD COLUMN IF NOT EXISTS consequence_quest_id uuid REFERENCES quests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS difficulty_rating     float DEFAULT 5.0 CHECK (difficulty_rating BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS is_consequence        boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS parent_task_id        uuid REFERENCES tasks(id) ON DELETE SET NULL;

-- GAME_MASTER event log: narrative events generated by the game master
CREATE TABLE IF NOT EXISTS game_master_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type   text NOT NULL, -- streak_broken | streak_milestone | challenge_unlocked | consequence_triggered | level_up_narrative
  title        text NOT NULL,
  narrative    text,
  xp_delta     int  DEFAULT 0,
  quest_ids    uuid[],
  metadata     jsonb,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE game_master_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own events" ON game_master_events
  FOR ALL USING (auth.uid() = user_id);

-- Dynamic difficulty tracking per user
CREATE TABLE IF NOT EXISTS user_difficulty_profile (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_level  float NOT NULL DEFAULT 5.0,
  avg_completion float NOT NULL DEFAULT 0.7,
  streak_avg     float NOT NULL DEFAULT 0.0,
  last_adjusted  timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

ALTER TABLE user_difficulty_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own difficulty" ON user_difficulty_profile
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- supabase/migrations/20260529000006_tool_usage_rpc.sql
-- ============================================================
-- RPC called by toolRegistry.ts to track tool usage analytics
-- mavis_tool_registry already exists from earlier migration
CREATE OR REPLACE FUNCTION increment_tool_usage(p_tool_name text)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE mavis_tool_registry
  SET usage_count = coalesce(usage_count, 0) + 1,
      last_used_at = now()
  WHERE name = p_tool_name;
$$;

-- ============================================================
-- supabase/migrations/20260529000007_mem0_letta.sql
-- ============================================================
-- Mem0 sync log: tracks which conversations have been synced to Mem0
CREATE TABLE IF NOT EXISTS mavis_mem0_sync_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  conversation_id text,
  synced_at timestamptz DEFAULT now(),
  memory_count int DEFAULT 0,
  UNIQUE(user_id, conversation_id)
);
ALTER TABLE mavis_mem0_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own mem0 log" ON mavis_mem0_sync_log FOR ALL USING (auth.uid() = user_id);

-- Letta agent registry: one Letta agent per MAVIS mode/persona
CREATE TABLE IF NOT EXISTS mavis_letta_agents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  letta_agent_id text NOT NULL,
  persona_name text NOT NULL DEFAULT 'MAVIS',
  created_at timestamptz DEFAULT now(),
  last_messaged_at timestamptz,
  UNIQUE(user_id, persona_name)
);
ALTER TABLE mavis_letta_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own letta agents" ON mavis_letta_agents FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- supabase/migrations/20260529000008_video_gen.sql
-- ============================================================
-- Video generation job tracking
CREATE TABLE IF NOT EXISTS mavis_video_jobs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  prompt text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  request_id text,
  operation_name text,
  video_url text,
  duration_seconds int,
  aspect_ratio text DEFAULT '16:9',
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  error_message text
);
ALTER TABLE mavis_video_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own video jobs" ON mavis_video_jobs FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_video_jobs_user ON mavis_video_jobs(user_id, created_at DESC);

-- ============================================================
-- supabase/migrations/20260529000009_health_apis.sql
-- ============================================================
-- WHOOP OAuth tokens (one per user)
CREATE TABLE IF NOT EXISTS whoop_tokens (
  user_id uuid REFERENCES auth.users PRIMARY KEY,
  access_token text NOT NULL,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE whoop_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own whoop tokens" ON whoop_tokens FOR ALL USING (auth.uid() = user_id);

-- WHOOP daily health data
CREATE TABLE IF NOT EXISTS whoop_daily_data (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  date date NOT NULL,
  recovery_score numeric,
  hrv_rmssd numeric,
  resting_hr numeric,
  sleep_performance numeric,
  sleep_hours numeric,
  strain_score numeric,
  calories int,
  biomarkers jsonb DEFAULT '{}',
  raw_data jsonb DEFAULT '{}',
  synced_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);
ALTER TABLE whoop_daily_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own whoop data" ON whoop_daily_data FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_whoop_user_date ON whoop_daily_data(user_id, date DESC);

-- Samsung Galaxy Ring daily data
CREATE TABLE IF NOT EXISTS galaxy_ring_daily_data (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  date date NOT NULL,
  sleep_score numeric,
  cognitive_score numeric,
  stress_level numeric,
  hrv_rmssd numeric,
  spo2 numeric,
  skin_temp_c numeric,
  steps int,
  active_calories int,
  raw_data jsonb DEFAULT '{}',
  synced_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);
ALTER TABLE galaxy_ring_daily_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own ring data" ON galaxy_ring_daily_data FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_ring_user_date ON galaxy_ring_daily_data(user_id, date DESC);

-- Health integration settings
CREATE TABLE IF NOT EXISTS health_integration_settings (
  user_id uuid REFERENCES auth.users PRIMARY KEY,
  whoop_enabled boolean DEFAULT false,
  galaxy_ring_enabled boolean DEFAULT false,
  oura_enabled boolean DEFAULT false,
  auto_sync_interval_hours int DEFAULT 6,
  sync_to_mavis_context boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE health_integration_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own health settings" ON health_integration_settings FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- supabase/migrations/20260529000010_agentic_integrations.sql
-- ============================================================
-- A2A protocol task queue
CREATE TABLE IF NOT EXISTS a2a_tasks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  external_agent_id text,
  skill_id text NOT NULL,
  status text NOT NULL DEFAULT 'submitted',
  input_message text NOT NULL,
  output_message text,
  artifacts jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE a2a_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own a2a tasks" ON a2a_tasks FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_a2a_tasks_user ON a2a_tasks(user_id, created_at DESC);

-- Code delegation sessions (Devin/Cursor)
CREATE TABLE IF NOT EXISTS code_delegation_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  provider text NOT NULL DEFAULT 'devin',
  external_session_id text,
  task_description text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  session_url text,
  prs_created jsonb DEFAULT '[]',
  messages jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE code_delegation_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own code sessions" ON code_delegation_sessions FOR ALL USING (auth.uid() = user_id);

-- Computer use task log
CREATE TABLE IF NOT EXISTS computer_use_tasks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  task_description text NOT NULL,
  model text NOT NULL DEFAULT 'computer-use-preview',
  actions_taken jsonb DEFAULT '[]',
  status text NOT NULL DEFAULT 'pending',
  result text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE computer_use_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own computer use" ON computer_use_tasks FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- supabase/migrations/20260529000011_finance_education.sql
-- ============================================================
-- Finance, scheduling, and education data tables
-- Era.app financial cache, Reclaim.ai schedule blocks, Khanmigo tutoring sessions

-- Financial data cache
CREATE TABLE IF NOT EXISTS era_financial_cache (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  cache_type text NOT NULL, -- 'accounts', 'transactions', 'goals', 'net_worth'
  data jsonb NOT NULL DEFAULT '{}',
  period_start date,
  period_end date,
  synced_at timestamptz DEFAULT now(),
  UNIQUE(user_id, cache_type, period_start)
);
ALTER TABLE era_financial_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own finance cache" ON era_financial_cache FOR ALL USING (auth.uid() = user_id);

-- Reclaim.ai schedule blocks
CREATE TABLE IF NOT EXISTS reclaim_schedule_blocks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  reclaim_task_id text,
  title text NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  block_type text DEFAULT 'task',
  health_triggered boolean DEFAULT false,
  synced_at timestamptz DEFAULT now()
);
ALTER TABLE reclaim_schedule_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own schedule" ON reclaim_schedule_blocks FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_reclaim_user_time ON reclaim_schedule_blocks(user_id, start_time);

-- Khanmigo Socratic tutoring sessions
CREATE TABLE IF NOT EXISTS tutoring_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  subject text NOT NULL,
  topic_id text,
  messages jsonb DEFAULT '[]',
  current_problem text,
  solved boolean DEFAULT false,
  hints_used int DEFAULT 0,
  time_spent_seconds int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE tutoring_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own tutoring" ON tutoring_sessions FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_tutoring_user ON tutoring_sessions(user_id, created_at DESC);

-- ============================================================
-- supabase/migrations/20260529000012_social_wearables.sql
-- ============================================================
-- NORA content pipeline queue
CREATE TABLE IF NOT EXISTS nora_content_queue (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  platform text NOT NULL,
  content text NOT NULL,
  hashtags text[],
  scheduled_for timestamptz,
  posted_at timestamptz,
  status text NOT NULL DEFAULT 'draft',
  performance_data jsonb DEFAULT '{}',
  ai_generated boolean DEFAULT true,
  source_topic text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE nora_content_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own nora content" ON nora_content_queue FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_nora_content_user ON nora_content_queue(user_id, scheduled_for);

-- Screenpipe memory sync log
CREATE TABLE IF NOT EXISTS screenpipe_sync_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  synced_at timestamptz DEFAULT now(),
  items_synced int DEFAULT 0,
  memories_created int DEFAULT 0,
  context_window_minutes int DEFAULT 30
);
ALTER TABLE screenpipe_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own screenpipe log" ON screenpipe_sync_log FOR ALL USING (auth.uid() = user_id);

-- Wearable overlay history
CREATE TABLE IF NOT EXISTS wearable_overlay_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  device_type text NOT NULL,
  content text NOT NULL,
  overlay_type text DEFAULT 'ambient',
  displayed_at timestamptz DEFAULT now(),
  duration_ms int
);
ALTER TABLE wearable_overlay_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own overlay history" ON wearable_overlay_history FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- supabase/migrations/20260529000013_website_builder.sql
-- ============================================================
-- Website clients (per service customer)
CREATE TABLE IF NOT EXISTS website_clients (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  client_name text NOT NULL,
  client_email text,
  client_phone text,
  business_name text,
  business_type text,
  location text,
  notes text,
  project_count int DEFAULT 0,
  total_value_cents int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE website_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own clients" ON website_clients FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_website_clients_user ON website_clients(user_id, created_at DESC);

-- Website projects (one project = one client website)
CREATE TABLE IF NOT EXISTS website_projects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  client_id uuid REFERENCES website_clients ON DELETE SET NULL,
  project_name text NOT NULL,
  business_name text,
  business_type text DEFAULT 'local_business',
  description text,
  target_audience text,
  unique_value text,
  location text,
  style text DEFAULT 'modern',
  color_scheme text DEFAULT 'blue',
  pages_requested text[] DEFAULT ARRAY['home','about','services','contact'],
  status text NOT NULL DEFAULT 'planning',
  wp_site_url text,
  pages_count int DEFAULT 0,
  site_content jsonb,
  hero_image_url text,
  preview_url text,
  price_cents int,
  paid boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  published_at timestamptz,
  delivered_at timestamptz
);
ALTER TABLE website_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own projects" ON website_projects FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_website_projects_user ON website_projects(user_id, created_at DESC);
CREATE INDEX idx_website_projects_client ON website_projects(client_id);

-- WordPress credentials (per site)
CREATE TABLE IF NOT EXISTS wp_credentials (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  project_id uuid REFERENCES website_projects ON DELETE CASCADE,
  site_url text NOT NULL,
  wp_username text NOT NULL,
  app_password text NOT NULL,
  label text,
  verified boolean DEFAULT false,
  last_used_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE wp_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own wp creds" ON wp_credentials FOR ALL USING (auth.uid() = user_id);

-- Generated website pages
CREATE TABLE IF NOT EXISTS website_pages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES website_projects ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,
  page_type text NOT NULL,
  wp_page_id int,
  title text,
  slug text,
  content_brief text,
  blocks_json text,
  meta_title text,
  meta_description text,
  hero_image_url text,
  status text DEFAULT 'draft',
  wp_url text,
  seo_score int,
  created_at timestamptz DEFAULT now(),
  published_at timestamptz,
  UNIQUE(project_id, page_type)
);
ALTER TABLE website_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own pages" ON website_pages FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_website_pages_project ON website_pages(project_id);

-- Website generation jobs (track long-running builds)
CREATE TABLE IF NOT EXISTS website_generation_jobs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  project_id uuid REFERENCES website_projects ON DELETE CASCADE NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  current_step text,
  steps_total int DEFAULT 0,
  steps_completed int DEFAULT 0,
  error_message text,
  result jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE website_generation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own jobs" ON website_generation_jobs FOR ALL USING (auth.uid() = user_id);

-- Service pricing tiers
CREATE TABLE IF NOT EXISTS website_service_tiers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  tier_name text NOT NULL,
  description text,
  pages_included int DEFAULT 5,
  price_cents int NOT NULL,
  includes_ecommerce boolean DEFAULT false,
  includes_blog boolean DEFAULT false,
  includes_seo boolean DEFAULT true,
  includes_revisions int DEFAULT 2,
  turnaround_days int DEFAULT 3,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE website_service_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own tiers" ON website_service_tiers FOR ALL USING (auth.uid() = user_id);

-- Seed default service tiers (runs on first insert)
-- Users will customize these

-- ============================================================
-- supabase/migrations/20260529000014_widget_system.sql
-- ============================================================
-- Widget instances (each deployed widget = one row)
CREATE TABLE IF NOT EXISTS widget_instances (
  id text PRIMARY KEY,                          -- 12-char alphanumeric widget ID
  user_id uuid REFERENCES auth.users NOT NULL,
  project_id uuid REFERENCES website_projects ON DELETE SET NULL,
  widget_type text NOT NULL,                    -- chat|lead_capture|quote_calculator|faq|roi_calculator|appointment_booker
  config jsonb NOT NULL DEFAULT '{}',           -- all widget configuration
  business_context text,                        -- extra AI context
  public_url text,                              -- CDN URL of widget.js
  status text NOT NULL DEFAULT 'active',        -- active|paused|deleted
  monthly_price_cents int DEFAULT 4900,
  subscription_status text DEFAULT 'trial',     -- trial|active|cancelled
  trial_ends_at timestamptz DEFAULT (now() + interval '14 days'),
  total_requests int DEFAULT 0,
  total_leads int DEFAULT 0,
  total_conversations int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE widget_instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own widgets" ON widget_instances FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_widgets_user ON widget_instances(user_id, created_at DESC);
CREATE INDEX idx_widgets_project ON widget_instances(project_id);

-- Widget chat logs
CREATE TABLE IF NOT EXISTS widget_chat_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  widget_id text REFERENCES widget_instances NOT NULL,
  session_id text NOT NULL,
  message text NOT NULL,
  reply text NOT NULL,
  response_ms int,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE widget_chat_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own chat logs" ON widget_chat_logs FOR ALL
  USING (EXISTS (SELECT 1 FROM widget_instances WHERE id = widget_chat_logs.widget_id AND user_id = auth.uid()));
CREATE INDEX idx_chat_logs_widget ON widget_chat_logs(widget_id, created_at DESC);

-- Widget leads (from lead capture, quote calculator, appointment booker)
CREATE TABLE IF NOT EXISTS widget_leads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  widget_id text REFERENCES widget_instances NOT NULL,
  lead_type text NOT NULL DEFAULT 'contact',   -- contact|quote|roi|appointment
  name text,
  email text,
  phone text,
  company text,
  message text,
  source_url text,
  metadata jsonb DEFAULT '{}',                 -- quote inputs, appointment details, etc.
  status text NOT NULL DEFAULT 'new',          -- new|contacted|converted|lost
  contacted_at timestamptz,
  converted_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE widget_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own leads" ON widget_leads FOR ALL
  USING (EXISTS (SELECT 1 FROM widget_instances WHERE id = widget_leads.widget_id AND user_id = auth.uid()));
CREATE INDEX idx_leads_widget ON widget_leads(widget_id, created_at DESC);
CREATE INDEX idx_leads_status ON widget_leads(status, created_at DESC);

-- Widget daily usage stats
CREATE TABLE IF NOT EXISTS widget_usage_stats (
  widget_id text REFERENCES widget_instances NOT NULL,
  date date NOT NULL DEFAULT current_date,
  action_type text NOT NULL,
  request_count int DEFAULT 0,
  PRIMARY KEY (widget_id, date, action_type)
);
ALTER TABLE widget_usage_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own usage" ON widget_usage_stats FOR ALL
  USING (EXISTS (SELECT 1 FROM widget_instances WHERE id = widget_usage_stats.widget_id AND user_id = auth.uid()));

-- Increment usage count RPC
CREATE OR REPLACE FUNCTION increment_widget_usage(p_widget_id text, p_action text)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO widget_usage_stats(widget_id, date, action_type, request_count)
  VALUES (p_widget_id, current_date, p_action, 1)
  ON CONFLICT (widget_id, date, action_type)
  DO UPDATE SET request_count = widget_usage_stats.request_count + 1;
$$;

-- Widget monthly revenue view (for billing dashboard)
CREATE OR REPLACE VIEW widget_revenue_summary AS
SELECT
  w.user_id,
  COUNT(*) as total_widgets,
  COUNT(*) FILTER (WHERE w.subscription_status = 'active') as active_widgets,
  SUM(w.monthly_price_cents) FILTER (WHERE w.subscription_status = 'active') as mrr_cents,
  SUM(w.total_leads) as total_leads_captured,
  SUM(w.total_requests) as total_api_requests
FROM widget_instances w
GROUP BY w.user_id;

-- Supabase Storage bucket for widget JS files (public)
-- Note: actual bucket creation requires Supabase dashboard or CLI
-- Run: supabase storage buckets create widgets --public
-- This migration documents the requirement
DO $$
BEGIN
  RAISE NOTICE 'REQUIRED: Create a public Supabase Storage bucket named "widgets" via dashboard or CLI: supabase storage buckets create widgets --public';
END $$;

-- ============================================================
-- supabase/migrations/20260530000001_mavis_planner.sql
-- ============================================================
-- Extend mavis_plans with columns used by the mavis-planner edge function
ALTER TABLE mavis_plans
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Extend mavis_plan_steps with phase-based planning columns used by mavis-planner
ALTER TABLE mavis_plan_steps
  ADD COLUMN IF NOT EXISTS phase text,
  ADD COLUMN IF NOT EXISTS step_order int,
  ADD COLUMN IF NOT EXISTS estimated_minutes int DEFAULT 30,
  ADD COLUMN IF NOT EXISTS quest_id uuid;

CREATE INDEX IF NOT EXISTS idx_mavis_plan_steps_plan_id ON mavis_plan_steps(plan_id);

-- ============================================================
-- supabase/migrations/20260530000002_stripe_widget_billing.sql
-- ============================================================
ALTER TABLE widget_instances
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_price_id text,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_widget_instances_stripe_sub ON widget_instances(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_widget_instances_stripe_cust ON widget_instances(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- Track Stripe event IDs to prevent double-processing
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id text PRIMARY KEY,  -- Stripe event ID (evt_xxx)
  type text NOT NULL,
  processed_at timestamptz DEFAULT now()
);

-- ============================================================
-- supabase/migrations/20260530000003_video_editor.sql
-- ============================================================
-- Video projects (one per uploaded/linked video)
CREATE TABLE IF NOT EXISTS video_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  title text NOT NULL,
  source_url text,                    -- original video URL (storage or external)
  source_type text DEFAULT 'upload',  -- upload|youtube|loom|url
  duration_seconds int,
  status text DEFAULT 'pending',      -- pending|analyzing|ready|error
  transcript text,                    -- full transcript text
  transcript_chunks jsonb,            -- array of {start, end, text} word-level chunks
  gemini_analysis jsonb,              -- raw Gemini analysis output
  summary text,
  language text DEFAULT 'en',
  storage_path text,                  -- path in Supabase Storage
  thumbnail_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Scored segments (10-second windows scored across 6 dimensions)
CREATE TABLE IF NOT EXISTS video_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES video_projects ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,
  start_seconds numeric NOT NULL,
  end_seconds numeric NOT NULL,
  transcript_text text,
  score_energy numeric DEFAULT 0,       -- 0-10: voice amplitude, pace, exclamations
  score_insight numeric DEFAULT 0,      -- 0-10: semantic density, novel info, data
  score_emotion numeric DEFAULT 0,      -- 0-10: emotional language, sentiment peaks
  score_hook numeric DEFAULT 0,         -- 0-10: opens with question/surprise/claim
  score_quotability numeric DEFAULT 0,  -- 0-10: complete standalone thought
  score_visual numeric DEFAULT 0,       -- 0-10: visual energy, scene interest
  viral_score numeric DEFAULT 0,        -- 0-10: weighted composite
  segment_order int NOT NULL
);

-- Generated clips (recommended cuts for specific output formats)
CREATE TABLE IF NOT EXISTS video_clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES video_projects ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,
  title text NOT NULL,
  start_seconds numeric NOT NULL,
  end_seconds numeric NOT NULL,
  duration_seconds numeric GENERATED ALWAYS AS (end_seconds - start_seconds) STORED,
  format text NOT NULL,               -- shorts|reels|highlight|long_form|custom
  aspect_ratio text DEFAULT '9:16',   -- 9:16|16:9|1:1
  viral_score numeric DEFAULT 0,
  why_viral text,
  suggested_caption text,
  suggested_hashtags text[],
  transcript_excerpt text,
  render_status text DEFAULT 'pending', -- pending|rendering|ready|error
  render_url text,                    -- URL of rendered clip
  thumbnail_url text,
  render_job_id text,                 -- fal.ai or render provider job ID
  nora_queued boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Render jobs (async rendering queue)
CREATE TABLE IF NOT EXISTS video_render_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id uuid REFERENCES video_clips ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,
  provider text DEFAULT 'fal',
  provider_job_id text,
  status text DEFAULT 'pending',      -- pending|processing|complete|failed
  input_url text NOT NULL,
  output_url text,
  ffmpeg_cmd text,                    -- the FFmpeg command used (for transparency)
  error_message text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- RLS
ALTER TABLE video_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_render_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users own video_projects" ON video_projects FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users own video_segments" ON video_segments FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users own video_clips" ON video_clips FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users own video_render_jobs" ON video_render_jobs FOR ALL USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_video_projects_user ON video_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_video_segments_project ON video_segments(project_id);
CREATE INDEX IF NOT EXISTS idx_video_clips_project ON video_clips(project_id);
CREATE INDEX IF NOT EXISTS idx_video_clips_format ON video_clips(project_id, format);

-- Storage bucket note
-- Run: supabase storage buckets create video-projects --public
-- Or create via dashboard: Storage → New bucket → "video-projects" → Public

-- ============================================================
-- supabase/migrations/20260530000004_sub_quests.sql
-- ============================================================
-- Add parent_quest_id to enable sub-quests (quests nested under parent quests).
-- Sub-quests appear in the Quests tab under their parent quest.
-- MAVIS uses create_quest with parent_quest_id instead of create_task.
ALTER TABLE quests
  ADD COLUMN IF NOT EXISTS parent_quest_id uuid REFERENCES quests(id) ON DELETE CASCADE;

-- Index for efficient sub-quest lookup
CREATE INDEX IF NOT EXISTS idx_quests_parent_quest_id ON quests(parent_quest_id)
  WHERE parent_quest_id IS NOT NULL;

-- View: quests with sub-quest count (useful for UI badges)
CREATE OR REPLACE VIEW quest_with_sub_count AS
SELECT
  q.*,
  COUNT(sub.id) FILTER (WHERE sub.status = 'active')   AS active_sub_quest_count,
  COUNT(sub.id) FILTER (WHERE sub.status = 'completed') AS completed_sub_quest_count,
  COUNT(sub.id) AS total_sub_quest_count
FROM quests q
LEFT JOIN quests sub ON sub.parent_quest_id = q.id
WHERE q.parent_quest_id IS NULL  -- only top-level quests
GROUP BY q.id;

