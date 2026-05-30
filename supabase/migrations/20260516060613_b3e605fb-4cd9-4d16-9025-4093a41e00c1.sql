CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE public.mavis_notes ADD COLUMN IF NOT EXISTS embedding vector(1536);

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS mavis_notes_embedding_idx
    ON public.mavis_notes USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.match_mavis_notes(
  query_embedding vector(1536),
  match_user_id uuid,
  match_threshold float DEFAULT 0.45,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  title text,
  content text,
  tags text[],
  similarity float
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT n.id, n.title, n.content, n.tags,
         1 - (n.embedding <=> query_embedding) AS similarity
  FROM public.mavis_notes n
  WHERE n.user_id = match_user_id
    AND n.embedding IS NOT NULL
    AND 1 - (n.embedding <=> query_embedding) > match_threshold
  ORDER BY n.embedding <=> query_embedding
  LIMIT match_count;
$$;