-- Notes
CREATE TABLE public.mavis_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled Note',
  content TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  aliases TEXT[] NOT NULL DEFAULT '{}',
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.mavis_notes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users view own notes" ON public.mavis_notes FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Users insert own notes" ON public.mavis_notes FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Users update own notes" ON public.mavis_notes FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Users delete own notes" ON public.mavis_notes FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE INDEX idx_mavis_notes_user ON public.mavis_notes(user_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;
CREATE TRIGGER update_mavis_notes_updated_at BEFORE UPDATE ON public.mavis_notes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Links
CREATE TABLE public.mavis_note_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_note_id UUID NOT NULL REFERENCES public.mavis_notes(id) ON DELETE CASCADE,
  target_note_id UUID NOT NULL REFERENCES public.mavis_notes(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'relates_to',
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.mavis_note_links ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users view own note links" ON public.mavis_note_links FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.mavis_notes n WHERE n.id = source_note_id AND n.user_id = auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Users insert own note links" ON public.mavis_note_links FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.mavis_notes n WHERE n.id = source_note_id AND n.user_id = auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Users delete own note links" ON public.mavis_note_links FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.mavis_notes n WHERE n.id = source_note_id AND n.user_id = auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE INDEX idx_mavis_note_links_source ON public.mavis_note_links(source_note_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE INDEX idx_mavis_note_links_target ON public.mavis_note_links(target_note_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Versions
CREATE TABLE public.mavis_note_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  note_id UUID NOT NULL REFERENCES public.mavis_notes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.mavis_note_versions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users view own note versions" ON public.mavis_note_versions FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.mavis_notes n WHERE n.id = note_id AND n.user_id = auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Users insert own note versions" ON public.mavis_note_versions FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.mavis_notes n WHERE n.id = note_id AND n.user_id = auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE INDEX idx_mavis_note_versions_note ON public.mavis_note_versions(note_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;