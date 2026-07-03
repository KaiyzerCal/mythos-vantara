-- Agency specialist activations — persistent active specialist per user
-- Agency conversations — Telegram chat history per specialist

create table if not exists mavis_active_agency_specialists (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  agent_id     text not null,        -- e.g. "engineering/engineering-ai-engineer.md"
  agent_name   text not null,        -- human display name
  division     text not null,        -- division id slug
  raw_url      text not null,        -- raw.githubusercontent.com URL
  spec_content text not null,        -- cached spec markdown (avoid refetching)
  activated_at timestamptz default now(),
  unique(user_id)                    -- one active specialist per user at a time
);

alter table mavis_active_agency_specialists enable row level security;
create policy "own_agency_specialist"
  on mavis_active_agency_specialists for all
  using (auth.uid() = user_id);

create table if not exists mavis_agency_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  agent_id   text not null,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz default now()
);

alter table mavis_agency_conversations enable row level security;
create policy "own_agency_conversations"
  on mavis_agency_conversations for all
  using (auth.uid() = user_id);

create index if not exists idx_agency_activations_user
  on mavis_active_agency_specialists (user_id);

create index if not exists idx_agency_convos_user_agent
  on mavis_agency_conversations (user_id, agent_id, created_at desc);
