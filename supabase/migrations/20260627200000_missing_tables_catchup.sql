-- ── Missing tables catch-up migration ────────────────────────────────────────
-- Creates tables that exist in migrations but were not yet applied to the DB.
-- Safe to run multiple times (IF NOT EXISTS / DO $$ guards throughout).

-- ── mavis_goals ──────────────────────────────────────────────────────────────
-- Used by GoalsPage (/goals) for objective decomposition and tracking.

ALTER TABLE IF EXISTS mavis_notes
  ADD COLUMN IF NOT EXISTS last_reviewed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS next_review_at        timestamptz,
  ADD COLUMN IF NOT EXISTS review_interval_days  integer DEFAULT 7;

CREATE TABLE IF NOT EXISTS public.mavis_goals (
  id           uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  objective    text         NOT NULL,
  context      text         DEFAULT '',
  status       text         DEFAULT 'active',
  decomposed   boolean      DEFAULT false,
  quest_ids    uuid[]       DEFAULT '{}',
  created_at   timestamptz  DEFAULT now(),
  updated_at   timestamptz  DEFAULT now()
);

ALTER TABLE public.mavis_goals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "own goals" ON public.mavis_goals FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_mavis_goals_user_status
  ON public.mavis_goals (user_id, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mavis_goals TO authenticated;
GRANT ALL ON public.mavis_goals TO service_role;


-- ── mavis_daily_briefs ───────────────────────────────────────────────────────
-- Used by Dashboard to show the AI-generated morning brief.

CREATE TABLE IF NOT EXISTS public.mavis_daily_briefs (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brief_date   date         NOT NULL,
  brief_text   text         NOT NULL,
  sections     jsonb        NOT NULL DEFAULT '{}',
  created_at   timestamptz  NOT NULL DEFAULT now(),
  UNIQUE(user_id, brief_date)
);

ALTER TABLE public.mavis_daily_briefs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users see own briefs" ON public.mavis_daily_briefs
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Service role can manage briefs" ON public.mavis_daily_briefs
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_mavis_daily_briefs_user_date
  ON public.mavis_daily_briefs (user_id, brief_date DESC);

GRANT SELECT ON public.mavis_daily_briefs TO authenticated;
GRANT ALL ON public.mavis_daily_briefs TO service_role;


-- ── mavis_daily_scores ───────────────────────────────────────────────────────
-- Used by Dashboard to show daily performance score.

CREATE TABLE IF NOT EXISTS public.mavis_daily_scores (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score_date     date         NOT NULL,
  score          integer      NOT NULL CHECK (score BETWEEN 0 AND 100),
  components     jsonb        NOT NULL DEFAULT '{}',
  optimal_window text,
  trend          text         CHECK (trend IN ('improving', 'stable', 'declining')),
  recommendation text,
  raw_data       jsonb        NOT NULL DEFAULT '{}',
  created_at     timestamptz  NOT NULL DEFAULT now(),
  UNIQUE(user_id, score_date)
);

ALTER TABLE public.mavis_daily_scores ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users see own scores" ON public.mavis_daily_scores
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Service role can manage scores" ON public.mavis_daily_scores
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_mavis_daily_scores_user_date
  ON public.mavis_daily_scores (user_id, score_date DESC);

GRANT SELECT ON public.mavis_daily_scores TO authenticated;
GRANT ALL ON public.mavis_daily_scores TO service_role;


-- ── workflows + workflow_runs ─────────────────────────────────────────────────
-- Used by WorkflowsPage (/workflows) — visual node graph editor.

CREATE TABLE IF NOT EXISTS public.workflows (
  id               uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name             text         NOT NULL,
  description      text         DEFAULT '',
  trigger_type     text         DEFAULT 'manual',
  trigger_config   jsonb        DEFAULT '{}',
  steps            jsonb        DEFAULT '[]',
  is_active        boolean      DEFAULT true,
  last_run_at      timestamptz,
  last_run_status  text,
  created_at       timestamptz  DEFAULT now(),
  updated_at       timestamptz  DEFAULT now()
);

ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "workflows_owner" ON public.workflows
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.workflow_runs (
  id            uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_id   uuid         REFERENCES public.workflows(id) ON DELETE CASCADE,
  user_id       uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status        text         DEFAULT 'running',
  steps_log     jsonb        DEFAULT '[]',
  started_at    timestamptz  DEFAULT now(),
  completed_at  timestamptz
);

ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "workflow_runs_owner" ON public.workflow_runs
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflows TO authenticated;
GRANT ALL ON public.workflows TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_runs TO authenticated;
GRANT ALL ON public.workflow_runs TO service_role;
