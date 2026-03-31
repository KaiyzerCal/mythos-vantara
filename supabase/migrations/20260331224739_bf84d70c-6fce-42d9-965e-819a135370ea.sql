CREATE TABLE IF NOT EXISTS public.rankings_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'npc',
  rank TEXT NOT NULL DEFAULT 'D',
  level INTEGER NOT NULL DEFAULT 1,
  jjk_grade TEXT NOT NULL DEFAULT 'G4',
  op_tier TEXT NOT NULL DEFAULT 'Local',
  gpr INTEGER NOT NULL DEFAULT 1000,
  pvp INTEGER NOT NULL DEFAULT 5000,
  influence TEXT NOT NULL DEFAULT 'Local',
  notes TEXT NOT NULL DEFAULT '',
  source_transformation_id UUID NULL,
  is_self BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.rankings_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own ranking profiles"
ON public.rankings_profiles
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_rankings_profiles_user_id ON public.rankings_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_rankings_profiles_user_sort ON public.rankings_profiles(user_id, gpr DESC, pvp DESC, level DESC);
CREATE INDEX IF NOT EXISTS idx_rankings_profiles_source_transformation_id ON public.rankings_profiles(source_transformation_id);

CREATE OR REPLACE FUNCTION public.update_rankings_profiles_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_rankings_profiles_updated_at ON public.rankings_profiles;
CREATE TRIGGER update_rankings_profiles_updated_at
BEFORE UPDATE ON public.rankings_profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_rankings_profiles_updated_at();