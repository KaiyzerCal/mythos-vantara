-- ============================================================
-- YouTube publishing support for the avatar-video social pipeline.
-- ============================================================

ALTER TABLE public.mavis_social_queue
  ADD COLUMN IF NOT EXISTS heygen_avatar_id    text,
  ADD COLUMN IF NOT EXISTS heygen_voice_id     text,
  ADD COLUMN IF NOT EXISTS youtube_title       text,
  ADD COLUMN IF NOT EXISTS youtube_description text,
  ADD COLUMN IF NOT EXISTS youtube_video_id    text,
  ADD COLUMN IF NOT EXISTS youtube_url         text,
  ADD COLUMN IF NOT EXISTS youtube_status      text NOT NULL DEFAULT 'pending'
    CHECK (youtube_status IN ('pending','processing','done','failed','skipped'));

COMMENT ON COLUMN public.mavis_social_queue.heygen_avatar_id IS
  'Which HeyGen avatar actually produced this row''s video -- operator-facing transparency, never a hardcoded default.';

-- Extend mavis_social_posts.platform to allow 'youtube', preserving every
-- value the live constraint already allows. The constraint was last set by
-- 20260517270000_instagram_tiktok.sql to
--   ('twitter','linkedin','instagram','tiktok','discord','facebook','other')
-- -- do not shrink this list to a guessed subset.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mavis_social_posts_platform_check') THEN
    ALTER TABLE mavis_social_posts DROP CONSTRAINT mavis_social_posts_platform_check;
  END IF;
  ALTER TABLE mavis_social_posts ADD CONSTRAINT mavis_social_posts_platform_check
    CHECK (platform IN ('twitter', 'linkedin', 'instagram', 'tiktok', 'discord', 'facebook', 'other', 'youtube'));
END $$;
