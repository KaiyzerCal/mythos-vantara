-- ═══════════════════════════════════════════════════════════
-- LIFEOS INTEGRATION
-- Patterns from KaiyzerCal/LifeOS:
--   1. TELOS: life context hierarchy (mission → current → ideal → problems → strategies)
--   2. DA Identity: 12-trait digital agent personality model
--   3. Quest ISA Schema: current_state, ideal_state, effort_tier, phase, completion_criteria
--   4. Freshness tracking: last_reviewed_at on quests, goals, memory
-- ═══════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. TELOS — Life context hierarchy
-- One row per user. Mission is the north star; everything else cascades from it.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mavis_telos (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mission         text        NOT NULL DEFAULT '',
  current_state   text        NOT NULL DEFAULT '',
  ideal_state     text        NOT NULL DEFAULT '',
  problems        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  challenges      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  strategies      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  narratives      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  time_horizon    text        NOT NULL DEFAULT '3y',
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE mavis_telos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "own telos" ON mavis_telos FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_mavis_telos_user ON mavis_telos(user_id);

-- ─────────────────────────────────────────────────────────────
-- 2. DA Identity — 12-trait digital agent personality model
-- Traits are 0-100 sliders. Presets are named calibration profiles.
-- growth_diary: array of { date, note, trait_delta } entries
-- opinion_log: array of { topic, stance, reasoning, date } entries
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mavis_da_identity (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  traits          jsonb       NOT NULL DEFAULT '{
    "enthusiasm": 70,
    "warmth": 65,
    "directness": 75,
    "precision": 80,
    "playfulness": 55,
    "formality": 45,
    "challenge_tendency": 60,
    "empathy": 70,
    "brevity": 65,
    "initiative": 70,
    "skepticism": 55,
    "creativity": 65
  }'::jsonb,
  preset          text        NOT NULL DEFAULT 'Balanced',
  growth_diary    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  opinion_log     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE mavis_da_identity ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "own da_identity" ON mavis_da_identity FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_mavis_da_identity_user ON mavis_da_identity(user_id);

-- ─────────────────────────────────────────────────────────────
-- 3. Quest ISA Schema
-- current_state: where the operator is NOW on this quest
-- ideal_state: the concrete end state that defines done
-- effort_tier: E1 (trivial) → E5 (life-changing), based on LifeOS ISA framework
-- phase: PLAN → BUILD → VERIFY → DONE
-- completion_criteria: array of binary testable strings ("Has X been done?")
-- decisions_log: append-only changelog of key decisions
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.quests
  ADD COLUMN IF NOT EXISTS current_state       text,
  ADD COLUMN IF NOT EXISTS ideal_state         text,
  ADD COLUMN IF NOT EXISTS effort_tier         text CHECK (effort_tier IN ('E1','E2','E3','E4','E5')),
  ADD COLUMN IF NOT EXISTS phase               text CHECK (phase IN ('PLAN','BUILD','VERIFY','DONE')),
  ADD COLUMN IF NOT EXISTS completion_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS decisions_log       jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ─────────────────────────────────────────────────────────────
-- 4. Freshness tracking — A-F grading
-- A: ≤7d   B: ≤30d   C: ≤90d   D: ≤180d   E: ≤365d   F: never / >365d
-- MAVIS surfaces stale context proactively.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.quests
  ADD COLUMN IF NOT EXISTS last_reviewed_at timestamptz;

ALTER TABLE public.mavis_goals
  ADD COLUMN IF NOT EXISTS last_reviewed_at timestamptz;

ALTER TABLE public.mavis_memory
  ADD COLUMN IF NOT EXISTS last_reviewed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_quests_reviewed_at ON public.quests(user_id, last_reviewed_at);
CREATE INDEX IF NOT EXISTS idx_mavis_goals_reviewed_at ON public.mavis_goals(user_id, last_reviewed_at);
