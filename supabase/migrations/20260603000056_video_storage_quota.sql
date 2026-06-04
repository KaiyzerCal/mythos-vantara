-- Video projects storage bucket (was previously only a comment in the migration)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'video-projects',
  'video-projects',
  false,
  524288000,  -- 500 MB per file
  ARRAY['video/mp4','video/webm','video/ogg','video/quicktime','video/x-msvideo','video/mpeg','video/3gpp']
)
ON CONFLICT (id) DO NOTHING;

-- RLS: users upload to their own folder, read their own files
DO $$ BEGIN
  CREATE POLICY "Users upload to own video folder"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'video-projects' AND auth.uid()::text = (storage.foldername(name))[1]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users read own video files"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'video-projects' AND auth.uid()::text = (storage.foldername(name))[1]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users delete own video files"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'video-projects' AND auth.uid()::text = (storage.foldername(name))[1]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Video quota tracking table
CREATE TABLE IF NOT EXISTS public.video_quota (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  period_start  date not null default date_trunc('month', current_date)::date,
  analyses_used integer not null default 0,
  analyses_limit integer not null default 5,
  renders_used  integer not null default 0,
  renders_limit integer not null default 20,
  tier          text not null default 'free',   -- 'free','starter','pro','enterprise'
  updated_at    timestamptz not null default now(),
  unique(user_id, period_start)
);
ALTER TABLE public.video_quota ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own quota" ON public.video_quota FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX ON public.video_quota(user_id, period_start);

-- Website form submissions table (for contact form backend)
CREATE TABLE IF NOT EXISTS public.website_form_submissions (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid references public.website_projects(id) on delete set null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  form_type  text not null default 'contact',   -- 'contact','quote','newsletter'
  data       jsonb not null default '{}'::jsonb,
  ip_address text,
  notified   boolean not null default false,
  created_at timestamptz not null default now()
);
ALTER TABLE public.website_form_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own submissions" ON public.website_form_submissions FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX ON public.website_form_submissions(user_id, created_at desc);
CREATE INDEX ON public.website_form_submissions(project_id, created_at desc);
