-- mavis_causal_chains: AI-discovered causal patterns in operator life data
create table if not exists public.mavis_causal_chains (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  cause              text not null,
  effect             text not null,
  lag_days           integer not null default 0,
  correlation        numeric(4,3) not null check (correlation between -1 and 1),
  confidence         numeric(4,3) not null check (confidence between 0 and 1),
  sample_size        integer not null default 0,
  description        text not null,
  action_implication text,
  created_at         timestamptz not null default now(),
  week_of            date not null default current_date
);

alter table public.mavis_causal_chains enable row level security;
create policy "Users see own chains" on public.mavis_causal_chains for select using (auth.uid() = user_id);
create index on public.mavis_causal_chains(user_id, created_at desc);
