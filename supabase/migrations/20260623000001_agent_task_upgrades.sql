-- Agent task execution upgrades
-- Adds agent_name + draft_content to action queue, proactive agent schedule table,
-- and missing RLS write policies so mavis-agent can insert queue items.

-- ── 1. mavis_action_queue: allow service-role inserts + add agent_name column ──

ALTER TABLE public.mavis_action_queue
  ADD COLUMN IF NOT EXISTS agent_name text,          -- which persona/agent proposed this
  ADD COLUMN IF NOT EXISTS draft_content text;        -- human-readable draft (email body, etc.)

-- Allow the owner to insert their own queue items (needed when frontend queues directly)
DO $$ BEGIN
  CREATE POLICY "Users insert own actions" ON public.mavis_action_queue
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Allow the owner to update their own items (approve / reject / execute)
DO $$ BEGIN
  CREATE POLICY "Users update own actions" ON public.mavis_action_queue
    FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. mavis_agent_schedules — per-user cron configuration ────────────────────

CREATE TABLE IF NOT EXISTS public.mavis_agent_schedules (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_name  text         NOT NULL,   -- 'morning_brief' | 'inbox_monitor' | 'calendar_brief'
  enabled     boolean      NOT NULL DEFAULT true,
  cron_expr   text         NOT NULL DEFAULT '0 7 * * *',  -- daily at 7am
  last_run_at timestamptz,
  next_run_at timestamptz,
  config      jsonb        NOT NULL DEFAULT '{}',
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE public.mavis_agent_schedules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "own schedules" ON public.mavis_agent_schedules
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_schedules_user_agent
  ON public.mavis_agent_schedules(user_id, agent_name);

-- ── 3. mavis_agent_briefs — stores morning brief history ──────────────────────

CREATE TABLE IF NOT EXISTS public.mavis_agent_briefs (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brief_type      text         NOT NULL DEFAULT 'morning',
  summary         text,
  urgent_items    jsonb        NOT NULL DEFAULT '[]',
  calendar_preview text,
  actions_queued  integer      NOT NULL DEFAULT 0,
  raw_data        jsonb,
  created_at      timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE public.mavis_agent_briefs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "own briefs" ON public.mavis_agent_briefs
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_agent_briefs_user_created
  ON public.mavis_agent_briefs(user_id, created_at DESC);
