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

-- Acquire-or-fail, never queue.
--
-- Postgres queues lock requests in order, so a DDL statement WAITING for a lock
-- blocks every query that arrives behind it — including, for anything touching
-- auth.users, every sign-in. That is how an earlier run of this migration took
-- the app's auth down: the statement never completed, and the backlog behind it
-- exhausted the connection pool.
--
-- lock_timeout makes that failure mode unreachable. If the lock is not free
-- within three seconds this statement errors out and releases the queue,
-- instead of becoming a head-of-line block. Re-running it later is safe;
-- everything below is guarded with IF NOT EXISTS.
SET lock_timeout = '3s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.mavis_video_productions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

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
  -- a join back to the parent on every read.
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

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

ALTER TABLE public.mavis_video_productions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavis_video_beats       ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users manage own video productions"
  ON public.mavis_video_productions FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users manage own video beats"
  ON public.mavis_video_beats FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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

DO $$ BEGIN
  CREATE TRIGGER mavis_video_productions_updated_at
  BEFORE UPDATE ON public.mavis_video_productions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER mavis_video_beats_updated_at
  BEFORE UPDATE ON public.mavis_video_beats
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
