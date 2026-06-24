-- MAVIS Web Crawler + RAG
-- Deep web scraper queue and vector document store (replaces n8n "Deep Web Scrapper + RAG").

-- ── Crawl queue ───────────────────────────────────────────────────────────────
create table if not exists mavis_scrape_queue (
  id         bigserial primary key,
  user_id    uuid references auth.users(id) on delete cascade not null,
  link       text not null,
  domain     text not null,
  status     text not null default 'created'
               check (status in ('created','processing','done','error') or status like 'dead-%'),
  emails     text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists idx_msq_link_user
  on mavis_scrape_queue(user_id, link);

create index if not exists idx_msq_status
  on mavis_scrape_queue(user_id, status);

alter table mavis_scrape_queue enable row level security;

do $$ begin
  create policy "users own scrape queue"
    on mavis_scrape_queue for all using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- ── RAG documents store ───────────────────────────────────────────────────────
create table if not exists mavis_documents (
  id         bigserial primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  content    text,
  metadata   jsonb default '{}',
  embedding  vector(1536),
  created_at timestamptz default now()
);

create index if not exists idx_mdocs_user
  on mavis_documents(user_id);

-- IVFFlat index for fast cosine search (enable once you have >200 rows)
-- create index mavis_documents_embedding_idx
--   on mavis_documents using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table mavis_documents enable row level security;

do $$ begin
  create policy "users own documents"
    on mavis_documents for all using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- ── match_documents function ──────────────────────────────────────────────────
create or replace function match_documents (
  query_embedding vector(1536),
  match_user_id   uuid,
  match_count     int     default 5,
  filter          jsonb   default '{}'
)
returns table (
  id         bigint,
  content    text,
  metadata   jsonb,
  similarity float
)
language plpgsql
as $$
#variable_conflict use_column
begin
  return query
  select
    id,
    content,
    metadata,
    1 - (mavis_documents.embedding <=> query_embedding) as similarity
  from mavis_documents
  where user_id = match_user_id
    and embedding is not null
    and metadata @> filter
  order by mavis_documents.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Auto-update updated_at on scrape queue
create or replace function mavis_scrape_queue_set_updated()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_msq_ts on mavis_scrape_queue;
create trigger trg_msq_ts
  before update on mavis_scrape_queue
  for each row execute function mavis_scrape_queue_set_updated();
