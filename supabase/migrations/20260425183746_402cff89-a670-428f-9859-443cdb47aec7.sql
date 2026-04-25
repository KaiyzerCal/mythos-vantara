
-- Helper function for updated_at triggers
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 1. Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users read own chat attachments"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'chat-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users upload own chat attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'chat-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users update own chat attachments"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'chat-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete own chat attachments"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'chat-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

-- 2. chat_attachments table
CREATE TABLE public.chat_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  chat_kind TEXT NOT NULL CHECK (chat_kind IN ('mavis','council','persona')),
  thread_ref TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'document',
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  file_url TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  extracted_text TEXT NOT NULL DEFAULT '',
  processing_status TEXT NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending','processing','done','failed')),
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own chat attachments"
ON public.chat_attachments FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_chat_attachments_thread
ON public.chat_attachments (user_id, chat_kind, thread_ref, created_at DESC);

CREATE TRIGGER chat_attachments_updated_at
BEFORE UPDATE ON public.chat_attachments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Voice fields on personas
ALTER TABLE public.personas
  ADD COLUMN IF NOT EXISTS voice_id TEXT DEFAULT 'JBFqnCBsd6RMkjVDRZzb',
  ADD COLUMN IF NOT EXISTS voice_settings JSONB NOT NULL DEFAULT '{"stability":0.5,"similarity_boost":0.75,"style":0.3,"speed":1.0}'::jsonb;

-- 4. Voice on councils
ALTER TABLE public.councils
  ADD COLUMN IF NOT EXISTS voice_id TEXT,
  ADD COLUMN IF NOT EXISTS voice_settings JSONB NOT NULL DEFAULT '{"stability":0.5,"similarity_boost":0.75,"style":0.3,"speed":1.0}'::jsonb;
