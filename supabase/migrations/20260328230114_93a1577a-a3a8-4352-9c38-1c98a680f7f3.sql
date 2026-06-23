ALTER TABLE public.skills ADD COLUMN IF NOT EXISTS parent_skill_id uuid REFERENCES public.skills(id) ON DELETE SET NULL;

-- Add buff/debuff effects columns to quests for richer rewards
ALTER TABLE public.quests ADD COLUMN IF NOT EXISTS buff_effects jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.quests ADD COLUMN IF NOT EXISTS debuff_effects jsonb NOT NULL DEFAULT '[]'::jsonb;