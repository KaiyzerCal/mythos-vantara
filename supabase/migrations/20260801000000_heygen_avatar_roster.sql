-- ============================================================
-- Saved HeyGen avatar roster — a user can have multiple trained
-- avatars, not just one default. Each entry is {label, avatar_id,
-- voice_id}. default_heygen_avatar_id/voice_id (prior migration)
-- remain the "no avatar_id/avatar_name given" fallback; this roster
-- lets a caller reference any of the operator's avatars by name.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS saved_heygen_avatars jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.profiles.saved_heygen_avatars IS
  'Array of {label, avatar_id, voice_id} — every HeyGen avatar the operator has saved, selectable by label from Avatar Studio, MAVIS chat, or Telegram via avatar_name. Empty until the operator saves one.';
