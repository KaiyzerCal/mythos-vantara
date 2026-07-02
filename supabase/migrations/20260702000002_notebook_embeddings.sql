-- Semantic vector search for notebook sources using Supabase gte-small (384-dim)

alter table notebook_sources add column if not exists embedding vector(384);

create index if not exists idx_notebook_sources_embedding
  on notebook_sources using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

create or replace function match_notebook_sources(
  query_embedding vector(384),
  match_notebook_id uuid,
  match_threshold float default 0.35,
  match_count int default 6
) returns table (
  id uuid,
  title text,
  content text,
  source_type text,
  url text,
  word_count int,
  similarity float
) language sql stable as $$
  select
    id, title, content, source_type, url, word_count,
    1 - (embedding <=> query_embedding) as similarity
  from notebook_sources
  where notebook_id = match_notebook_id
    and embedding is not null
    and 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;
