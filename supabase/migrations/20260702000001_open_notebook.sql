-- Open Notebook — Supabase-native Notebook LM alternative
-- Notebooks > Sources > Notes + Chat sessions with context-aware AI

create table if not exists notebooks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  title       text not null default 'Untitled Notebook',
  description text,
  emoji       text not null default '📓',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists notebook_sources (
  id          uuid primary key default gen_random_uuid(),
  notebook_id uuid references notebooks(id) on delete cascade not null,
  user_id     uuid references auth.users(id) on delete cascade not null,
  title       text not null,
  source_type text not null check (source_type in ('text','url','youtube','file')),
  content     text,
  url         text,
  word_count  int default 0,
  metadata    jsonb default '{}',
  created_at  timestamptz default now()
);

create table if not exists notebook_notes (
  id          uuid primary key default gen_random_uuid(),
  notebook_id uuid references notebooks(id) on delete cascade not null,
  user_id     uuid references auth.users(id) on delete cascade not null,
  title       text,
  content     text not null,
  source_ids  uuid[] default '{}',
  is_ai       boolean default false,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists notebook_chats (
  id          uuid primary key default gen_random_uuid(),
  notebook_id uuid references notebooks(id) on delete cascade not null,
  user_id     uuid references auth.users(id) on delete cascade not null,
  title       text not null default 'New Chat',
  created_at  timestamptz default now()
);

create table if not exists notebook_messages (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid references notebook_chats(id) on delete cascade not null,
  role       text not null check (role in ('user','assistant')),
  content    text not null,
  created_at timestamptz default now()
);

-- RLS
alter table notebooks         enable row level security;
alter table notebook_sources  enable row level security;
alter table notebook_notes    enable row level security;
alter table notebook_chats    enable row level security;
alter table notebook_messages enable row level security;

create policy "own_notebooks"  on notebooks         for all using (auth.uid() = user_id);
create policy "own_sources"    on notebook_sources  for all using (auth.uid() = user_id);
create policy "own_notes"      on notebook_notes    for all using (auth.uid() = user_id);
create policy "own_chats"      on notebook_chats    for all using (auth.uid() = user_id);
create policy "own_messages"   on notebook_messages
  for all using (
    auth.uid() = (select user_id from notebook_chats where id = chat_id)
  );

-- Indexes
create index if not exists idx_notebooks_user        on notebooks        (user_id, created_at desc);
create index if not exists idx_notebook_sources_nb   on notebook_sources (notebook_id, created_at desc);
create index if not exists idx_notebook_notes_nb     on notebook_notes   (notebook_id, created_at desc);
create index if not exists idx_notebook_chats_nb     on notebook_chats   (notebook_id, created_at desc);
create index if not exists idx_notebook_messages_chat on notebook_messages (chat_id, created_at asc);
