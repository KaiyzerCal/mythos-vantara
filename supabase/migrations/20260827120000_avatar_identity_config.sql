-- Avatar identity configuration for the content pipeline.
--
-- Extends `personas` rather than adding an AvatarConfig table. personas already
-- carries name, system_prompt, archetype, voice_id, voice_settings, voice_style,
-- content_niche and avatar_key — a parallel table would have duplicated all of
-- that and left two rows free to disagree about who a persona is.
--
-- Four columns, all additive, all defaulted, nothing existing altered:
--
--   rendering_style  photorealistic (SkyForge / CodexOS) vs animated (Bioneer)
--   overlay_style    which on-screen graphics the director should plan for
--   domain_tags      subject territory, used to route a brief to an identity
--   asset_paths      base image, video seed, motion template, provider pins
--
-- The default is 'photorealistic' + 'none', which is exactly how every existing
-- persona already behaves — no row changes meaning when this runs.
--
-- NOTE: this backend is Lovable-managed. Committing this file does NOT apply
-- it — see CLAUDE.md. Confirm against the running database before assuming the
-- columns exist.

-- For a plain psql/CLI apply. The set_config calls below are what hold when
-- this is delivered through a pooler that may run the DDL on a different
-- session than this SET — see 20260822120000's header.
SET lock_timeout = '3s';
SET statement_timeout = '60s';

DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '60s', true);

  ALTER TABLE public.personas
    ADD COLUMN IF NOT EXISTS rendering_style text NOT NULL DEFAULT 'photorealistic',
    ADD COLUMN IF NOT EXISTS overlay_style   text NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS domain_tags     text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS asset_paths     jsonb  NOT NULL DEFAULT '{}'::jsonb;

  -- CHECKs added separately and guarded: ADD COLUMN IF NOT EXISTS is a no-op on
  -- a re-run, which would skip an inline CHECK and leave the column unconstrained
  -- with no error. Naming them makes the presence test exact.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'personas_rendering_style_check' AND conrelid = 'public.personas'::regclass
  ) THEN
    ALTER TABLE public.personas
      ADD CONSTRAINT personas_rendering_style_check
      CHECK (rendering_style IN ('photorealistic','animated'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'personas_overlay_style_check' AND conrelid = 'public.personas'::regclass
  ) THEN
    ALTER TABLE public.personas
      ADD CONSTRAINT personas_overlay_style_check
      CHECK (overlay_style IN ('none','tech_hud','motion_analysis'));
  END IF;
END $$;

-- Routing lookup: "which of this operator's identities covers this brief".
-- GIN because domain_tags is an array and the query is an overlap test.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '60s', true);

  CREATE INDEX IF NOT EXISTS idx_personas_domain_tags
    ON public.personas USING GIN (domain_tags);
END $$;

-- The production has to remember which identity it was planned under, or the
-- asset worker cannot apply the same visual register several minutes later
-- when it generates the frames.
--
-- persona_id alone is not enough: a preset identity (SkyForge, Bioneer) can
-- drive a production before the operator has forged it into a personas row, and
-- in that case there is no id to point at — only the key.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '60s', true);

  ALTER TABLE public.mavis_video_productions
    ADD COLUMN IF NOT EXISTS avatar_key text;
END $$;
