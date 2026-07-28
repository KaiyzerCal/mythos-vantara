
CREATE TABLE public.receptionist_businesses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  industry TEXT NOT NULL DEFAULT 'general',
  description TEXT DEFAULT '',
  greeting TEXT,
  hours JSONB,
  timezone TEXT DEFAULT 'America/New_York',
  plan TEXT DEFAULT 'starter',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receptionist_businesses TO authenticated;
GRANT ALL ON public.receptionist_businesses TO service_role;
ALTER TABLE public.receptionist_businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own businesses" ON public.receptionist_businesses FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.receptionist_phone_numbers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES public.receptionist_businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  vapi_phone_number_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receptionist_phone_numbers TO authenticated;
GRANT ALL ON public.receptionist_phone_numbers TO service_role;
ALTER TABLE public.receptionist_phone_numbers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own phone numbers" ON public.receptionist_phone_numbers FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.receptionist_calls (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES public.receptionist_businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  caller_number TEXT,
  duration_seconds INTEGER,
  transcript TEXT,
  summary TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receptionist_calls TO authenticated;
GRANT ALL ON public.receptionist_calls TO service_role;
ALTER TABLE public.receptionist_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own calls" ON public.receptionist_calls FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_receptionist_businesses_updated_at BEFORE UPDATE ON public.receptionist_businesses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
