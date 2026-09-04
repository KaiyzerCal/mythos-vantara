-- Courses the operator asked to learn: "name anything, learn it to mastery".
--
-- /study already reviews notes the operator wrote. This is the other half —
-- a named subject (a skill, book, essay, speech, film, documentary, textbook)
-- expanded into an eight-tier curriculum, with lessons and quizzes generated
-- per tier and a level that rises with demonstrated competency.
--
-- One row per course per operator. The tiers, the current lesson and the list
-- of already-covered lesson titles are jsonb rather than child tables: they
-- are written and read as a whole object by one screen, never queried across
-- courses, so splitting them into rows would buy joins nobody makes.
--
-- The four rules in CLAUDE.md, in order of how much they matter:
--
--  1. lock_timeout is set transaction-locally with set_config(..., true).
--     A session-level SET can land on a different backend through the
--     transaction pooler and silently protect nothing.
--  2. NO REFERENCE TO auth.users. Several existing tables in this repo use
--     `user_id uuid REFERENCES auth.users` — that is the exact line that took
--     the auth service down on 2026-08-22, because the FK needs a lock on the
--     table every sign-in depends on. Ownership only needs `user_id uuid NOT
--     NULL` plus an RLS policy; the FK would only have bought ON DELETE
--     CASCADE, which is not worth an outage.
--  3. Re-runnable. IF NOT EXISTS and the duplicate_object guard, so a
--     lock-timeout failure can simply be run again with no cleanup.
--  4. CREATE TABLE on a new name takes no lock anything else is waiting on,
--     and the indexes are created on an empty table.

BEGIN;
SELECT set_config('lock_timeout', '3s', true);
SELECT set_config('statement_timeout', '60s', true);

CREATE TABLE IF NOT EXISTS public.study_courses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  subject       text NOT NULL,
  kind          text NOT NULL DEFAULT 'Skill',
  title         text NOT NULL DEFAULT '',
  attribution   text NOT NULL DEFAULT '',
  premise       text NOT NULL DEFAULT '',
  -- [{tier, focus}] — exactly eight, in ascending order of competency.
  tiers         jsonb NOT NULL DEFAULT '[]'::jsonb,
  level         int  NOT NULL DEFAULT 1,
  xp            int  NOT NULL DEFAULT 0,
  -- Lesson titles already taught, so the generator does not repeat itself.
  covered       jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The lesson currently in front of the operator, so a reload resumes it.
  lesson        jsonb,
  -- Whether this course was built from the operator's own material or from
  -- the model's general knowledge. Shown in the UI: a course about someone
  -- else's book is useful, but the operator should know which it is.
  grounded_in   text NOT NULL DEFAULT 'general',
  sources       jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_opened_at timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.study_courses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "operator owns their study courses"
    ON public.study_courses FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_study_courses_user
  ON public.study_courses (user_id, last_opened_at DESC);

COMMIT;
