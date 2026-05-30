-- =============================================================================
-- 20260517270000_instagram_tiktok.sql
-- Add instagram and tiktok to the allowed platforms in mavis_social_posts.
-- Uses a DO block so it is safe to run on schemas that already have the
-- constraint (drops and recreates) as well as schemas where it was never added.
-- =============================================================================

DO $$
BEGIN
  -- Drop old check constraint if it exists and doesn't include new platforms
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mavis_social_posts_platform_check'
  ) THEN
    ALTER TABLE mavis_social_posts DROP CONSTRAINT mavis_social_posts_platform_check;
    ALTER TABLE mavis_social_posts ADD CONSTRAINT mavis_social_posts_platform_check
      CHECK (platform IN ('twitter', 'linkedin', 'instagram', 'tiktok', 'discord', 'facebook', 'other'));
  END IF;
END $$;
