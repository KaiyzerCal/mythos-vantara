-- Domain / area / curse / terrain effects.
-- Active effects that modify the operator's stats while in effect.
-- Separate from transformation buffs (which are form-based) and gear stat_effects
-- (which are item-based) — domain effects represent environmental or externally
-- applied modifiers: Domain Expansions, curses, terrain auras, zone effects, etc.

CREATE TABLE IF NOT EXISTS public.mavis_domain_effects (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  description    text,
  effect_type    text NOT NULL DEFAULT 'domain'
                   CHECK (effect_type IN ('domain', 'curse', 'terrain', 'environmental', 'aura', 'zone')),
  stat_modifiers jsonb NOT NULL DEFAULT '[]',  -- [{ label: "STR", value: -20, unit: "%" }]
  area_effects   text[] NOT NULL DEFAULT '{}', -- free-text area effect descriptions
  is_active      boolean NOT NULL DEFAULT true,
  expires_at     timestamptz,                  -- null = permanent until manually removed
  source         text,                         -- who/what applied this effect
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mavis_domain_effects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users own domain effects"
  ON public.mavis_domain_effects FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "service role manages domain effects"
  ON public.mavis_domain_effects FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_domain_effects_user_active
  ON public.mavis_domain_effects(user_id, is_active, created_at DESC);
