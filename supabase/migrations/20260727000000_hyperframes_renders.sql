-- ─────────────────────────────────────────────────────────────────────────────
-- hyperframes_renders — job tracking for HyperFrames HTML→MP4 renders
--
-- Ad-hoc generated videos (quest recaps, stats reels, persona clips) are not
-- tied to an existing video-editor project/clip the way video_clips/
-- video_render_jobs are, so this is a small, purpose-scoped table rather than
-- forcing this feature into the clip-editor's schema.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hyperframes_renders (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_job_id   text,
  status            text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','rendering','ready','failed')),
  width             integer     NOT NULL DEFAULT 1920,
  height            integer     NOT NULL DEFAULT 1080,
  fps               integer     NOT NULL DEFAULT 30,
  render_url        text,
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_hyperframes_renders_user_created
  ON public.hyperframes_renders (user_id, created_at DESC);

ALTER TABLE public.hyperframes_renders ENABLE ROW LEVEL SECURITY;

-- Operators can read their own renders. All writes go through mavis-hyperframes
-- (service role, bypasses RLS) — the render service itself never talks to
-- Supabase directly.
DO $$ BEGIN
  CREATE POLICY "read own hyperframes renders" ON public.hyperframes_renders
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
