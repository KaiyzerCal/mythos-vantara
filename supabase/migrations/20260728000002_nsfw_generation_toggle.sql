-- ============================================================
-- NSFW image generation toggle — server-side, fail-closed gate.
-- PromptChan integration (mavis-image-gen) checks this flag before ever
-- calling PromptChan in explicit mode. Defaults to false for every
-- existing and new account; must be flipped on deliberately.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS nsfw_generation_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.nsfw_generation_enabled IS
  'Server-side gate for PromptChan explicit-mode image generation (mavis-image-gen). Off by default — must be explicitly enabled per account.';
