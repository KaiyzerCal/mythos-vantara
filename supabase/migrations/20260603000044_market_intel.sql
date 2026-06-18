create table if not exists public.mavis_market_intel (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text not null,
  headline text not null,
  summary text not null,
  url text,
  relevance_score numeric(3,2) not null check (relevance_score between 0 and 1),
  signal_type text not null default 'news', -- 'news','trend','opportunity','risk'
  notified boolean not null default false,
  source_date date not null default current_date,
  created_at timestamptz not null default now()
);
alter table public.mavis_market_intel enable row level security;
create policy "Users see own intel" on public.mavis_market_intel for select using (auth.uid() = user_id);
create index on public.mavis_market_intel(user_id, created_at desc);
