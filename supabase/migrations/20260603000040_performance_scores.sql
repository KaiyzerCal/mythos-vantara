-- mavis_daily_scores: daily performance science snapshots
create table if not exists public.mavis_daily_scores (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  score_date     date not null,
  score          integer not null check (score between 0 and 100),
  components     jsonb not null default '{}',
  optimal_window text,
  trend          text check (trend in ('improving', 'stable', 'declining')),
  recommendation text,
  raw_data       jsonb not null default '{}',
  created_at     timestamptz not null default now(),
  unique(user_id, score_date)
);

alter table public.mavis_daily_scores enable row level security;
create policy "Users see own scores" on public.mavis_daily_scores for select using (auth.uid() = user_id);
create index on public.mavis_daily_scores(user_id, score_date desc);
