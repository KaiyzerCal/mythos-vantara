-- Media Intelligence: upload reference content → AI deconstruction → MAVIS production blueprint

CREATE TABLE IF NOT EXISTS public.mavis_media_library (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title               text,
  media_type          text         NOT NULL CHECK (media_type IN ('video','image')),
  storage_path        text         NOT NULL,
  file_url            text,
  mime_type           text,
  file_size_bytes     bigint,
  duration_seconds    numeric,
  width               integer,
  height              integer,
  source_tool         text,        -- 'heygen' | 'higgsfield' | 'canva' | 'runway' | 'capcut' | 'other'
  analysis            jsonb,       -- full AI deconstruction result
  blueprint           jsonb,       -- step-by-step MAVIS production plan
  gemini_file_uri     text,        -- Gemini File API URI for video analysis
  status              text         NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending','uploading','analyzing','ready','error')),
  error_message       text,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE public.mavis_media_library ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "own media library" ON public.mavis_media_library
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_media_library_user_created
  ON public.mavis_media_library(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_library_status
  ON public.mavis_media_library(user_id, status);
