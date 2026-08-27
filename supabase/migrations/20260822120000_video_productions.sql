-- Video productions — the storyboard model behind MAVIS's produce_video tool.
--
-- Additive only: two new tables, nothing existing is altered or dropped.
--
-- Why a persisted beat list rather than streaming straight to a renderer:
-- a production is minutes of wall clock across several paid providers, so it
-- has to survive a worker restart, retry one failed scene without redoing the
-- rest, and let the operator say "make scene 3 punchier" and re-render from the
-- same plan. None of that is possible if the plan only ever exists inside one
-- function invocation.
--
-- NOTE: this backend is Lovable-managed. Committing this file does NOT apply
-- it — see CLAUDE.md. Confirm against the running database before assuming the
-- tables exist.
--
-- ── Why this file is shaped the way it is ────────────────────────────────────
--
-- An earlier version of this migration took the app's auth service down. The
-- tables were new and empty and nothing referenced them; the damage came from
-- `REFERENCES auth.users(id)` inline in the column definitions. That FK needs a
-- lock on auth.users, it did not get one immediately, and every sign-in queued
-- behind the waiting statement until the connection pool filled.
--
-- Three changes, each from a rule in CLAUDE.md:
--
-- 1. lock_timeout is set with set_config(..., is_local => true) INSIDE each DO
--    block, not as a bare session-level SET. A bare SET is session state, and
--    applied through a transaction pooler the DDL can land on a different
--    session than the SET — leaving the statement running with no timeout at
--    all while looking guarded. is_local binds it to the transaction that
--    actually runs the DDL. (The session-level SET is kept below for a plain
--    psql/CLI apply, where it is the thing that works.)
--
-- 2. The auth.users foreign keys are NOT inline. Ownership is enforced by
--    `user_id uuid NOT NULL` plus RLS, which needs no lock on auth.users at
--    all. The FK buys exactly one thing — ON DELETE CASCADE — so it is added
--    at the very end, separately, and is allowed to fail. Inline, a lock
--    timeout on that one constraint rolls back the whole CREATE TABLE; split
--    out, the tables exist and work and only the cascade is missing.
--
-- 3. Every statement is re-runnable. A statement that fails on a lock timeout
--    must be safe to run again with no cleanup, or rule 1 has just traded an
--    outage for a half-applied schema.

-- For a plain psql/CLI apply. Redundant with the set_config calls below, and
-- deliberately so — see note 1.
SET lock_timeout = '3s';
SET statement_timeout = '60s';

-- ── Stage 1: tables ─────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '60s', true);

  CREATE TABLE IF NOT EXISTS public.mavis_video_productions (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- No FK to auth.users here on purpose — see note 2 in the header. RLS
    -- below is what enforces ownership; the cascade is added at the end.
    user_id          uuid        NOT NULL,

    -- What the operator actually asked for, kept verbatim so a re-storyboard
    -- starts from their words rather than from a summary of them.
    brief            text        NOT NULL,
    title            text        NOT NULL DEFAULT '',

    -- faceless    — generated visuals + voiceover, no performer
    -- avatar      — the operator's own AI avatar presents
    -- persona_ugc — one of the operator's personas presents, UGC style
    production_type  text        NOT NULL DEFAULT 'faceless'
                       CHECK (production_type IN ('faceless','avatar','persona_ugc')),

    format           text        NOT NULL DEFAULT '9:16'
                       CHECK (format IN ('9:16','1:1','16:9')),

    -- stills is the cheap default: one image per beat plus a Ken Burns move.
    -- video generates a clip per beat — better motion, far higher cost.
    visual_mode      text        NOT NULL DEFAULT 'stills'
                       CHECK (visual_mode IN ('stills','video')),

    target_seconds   integer     NOT NULL DEFAULT 45 CHECK (target_seconds BETWEEN 5 AND 600),

    -- Only meaningful for the typed variants; left null for faceless.
    -- personas is an ordinary application table, not auth.users — this FK is
    -- safe inline.
    persona_id       uuid        REFERENCES public.personas(id) ON DELETE SET NULL,
    avatar_name      text,
    voice_id         text,

    status           text        NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','storyboarded','generating','composing','rendering','ready','failed')),

    -- Set once the composition is handed to mavis-hyperframes.
    render_id        uuid,
    output_url       text,

    -- Non-fatal notes from the planner (dropped beats, unreachable runtime) that
    -- MAVIS reads back to the operator in chat.
    warnings         jsonb       NOT NULL DEFAULT '[]'::jsonb,
    error_message    text,

    -- Spend ceiling, counted in paid generation calls rather than currency —
    -- provider pricing isn't knowable from in here, but "this video may make at
    -- most N generation calls" is, and it is what stops a retry loop from
    -- quietly running up a bill. Set from the beat count at storyboard time.
    generation_budget  integer   NOT NULL DEFAULT 30 CHECK (generation_budget >= 0),
    generations_used   integer   NOT NULL DEFAULT 0 CHECK (generations_used >= 0),

    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS public.mavis_video_beats (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    production_id    uuid        NOT NULL REFERENCES public.mavis_video_productions(id) ON DELETE CASCADE,
    -- Denormalised so RLS on this table stands on its own rather than requiring
    -- a join back to the parent on every read. Same no-inline-FK rule as above.
    user_id          uuid        NOT NULL,

    idx              integer     NOT NULL CHECK (idx >= 0),
    narration        text        NOT NULL DEFAULT '',
    visual_prompt    text        NOT NULL DEFAULT '',
    on_screen_text   text        NOT NULL DEFAULT '',
    seconds          numeric(6,2) NOT NULL DEFAULT 3 CHECK (seconds > 0),

    -- Filled in by the asset worker: the picture and the voiceover for this beat.
    asset_url        text,
    audio_url        text,

    -- Video generation is submit-then-poll and outlives a single worker tick, so
    -- the provider job has to be remembered across ticks. Null in stills mode,
    -- where image generation returns a URL inline.
    provider         text,
    provider_job_id  text,

    status           text        NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','generating','ready','failed','skipped')),
    error_message    text,
    attempts         integer     NOT NULL DEFAULT 0,

    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),

    UNIQUE (production_id, idx)
  );
END $$;

-- ── Stage 2: RLS, grants, indexes, triggers ─────────────────────────────────
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '60s', true);

  ALTER TABLE public.mavis_video_productions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.mavis_video_beats       ENABLE ROW LEVEL SECURITY;

  BEGIN
    CREATE POLICY "Users manage own video productions"
    ON public.mavis_video_productions FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  EXCEPTION WHEN duplicate_object THEN NULL; END;

  BEGIN
    CREATE POLICY "Users manage own video beats"
    ON public.mavis_video_beats FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  EXCEPTION WHEN duplicate_object THEN NULL; END;

  GRANT SELECT, INSERT, UPDATE, DELETE ON public.mavis_video_productions TO authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.mavis_video_beats       TO authenticated;
  GRANT ALL ON public.mavis_video_productions TO service_role;
  GRANT ALL ON public.mavis_video_beats       TO service_role;

  CREATE INDEX IF NOT EXISTS idx_video_productions_user
    ON public.mavis_video_productions (user_id, created_at DESC);

  -- The asset worker's hot path: "which productions still have work to do".
  CREATE INDEX IF NOT EXISTS idx_video_productions_active
    ON public.mavis_video_productions (status, updated_at)
    WHERE status IN ('storyboarded','generating','composing','rendering');

  CREATE INDEX IF NOT EXISTS idx_video_beats_production
    ON public.mavis_video_beats (production_id, idx);

  CREATE INDEX IF NOT EXISTS idx_video_beats_pending
    ON public.mavis_video_beats (production_id)
    WHERE status IN ('pending','generating');

  BEGIN
    CREATE TRIGGER mavis_video_productions_updated_at
    BEFORE UPDATE ON public.mavis_video_productions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  EXCEPTION WHEN duplicate_object THEN NULL; END;

  BEGIN
    CREATE TRIGGER mavis_video_beats_updated_at
    BEFORE UPDATE ON public.mavis_video_beats
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ── Stage 3: the auth.users cascade, last and optional ──────────────────────
--
-- This is the statement that caused the outage, isolated so it can fail
-- without taking anything else with it. It is the ONLY thing here that touches
-- auth.users.
--
-- NOT VALID skips the scan of the referencing table (empty anyway); the lock it
-- still needs is on the REFERENCED side, which is the dangerous one, so
-- lock_timeout is what actually protects this — not NOT VALID.
--
-- If it times out, the tables are already live and correct: RLS enforces
-- ownership, and the only thing missing is automatic cleanup of rows belonging
-- to a deleted user. Re-run this file at a quieter moment to pick it up; the
-- guards make that a no-op for everything above.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '60s', true);

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mavis_video_productions_user_id_fkey'
      AND conrelid = 'public.mavis_video_productions'::regclass
  ) THEN
    ALTER TABLE public.mavis_video_productions
      ADD CONSTRAINT mavis_video_productions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mavis_video_beats_user_id_fkey'
      AND conrelid = 'public.mavis_video_beats'::regclass
  ) THEN
    ALTER TABLE public.mavis_video_beats
      ADD CONSTRAINT mavis_video_beats_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
EXCEPTION
  -- lock_not_available: auth.users was busy. Not a failure of this migration —
  -- everything above is applied and working. Say so rather than aborting.
  WHEN lock_not_available THEN
    RAISE WARNING 'video: auth.users cascade skipped (table busy). Tables are live; re-run this file later to add it.';
END $$;
