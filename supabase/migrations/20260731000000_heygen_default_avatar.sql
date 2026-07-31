-- ============================================================
-- Saved default HeyGen avatar/voice — lets a user pick a trained
-- avatar (e.g. a HeyGen digital clone) once in Avatar Studio and
-- have it reused by generation calls that don't explicitly pass one.
-- No default value — NULL until a user sets one; never assume a
-- stock avatar.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_heygen_avatar_id text,
  ADD COLUMN IF NOT EXISTS default_heygen_voice_id  text;

COMMENT ON COLUMN public.profiles.default_heygen_avatar_id IS
  'Runtime-configured HeyGen trained-avatar ID used by Avatar Studio and avatar_social_post. NULL until the user sets it via Avatar Studio — never hardcode a default here.';
COMMENT ON COLUMN public.profiles.default_heygen_voice_id IS
  'Runtime-configured HeyGen voice ID paired with default_heygen_avatar_id. Optional — callers may override per request.';
