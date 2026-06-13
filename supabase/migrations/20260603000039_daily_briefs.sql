-- mavis_daily_briefs: stores daily AI-generated briefs for in-app display
create table if not exists public.mavis_daily_briefs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  brief_date   date not null,
  brief_text   text not null,
  sections     jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  unique(user_id, brief_date)
);

alter table public.mavis_daily_briefs enable row level security;
create policy "Users see own briefs" on public.mavis_daily_briefs for select using (auth.uid() = user_id);
create index on public.mavis_daily_briefs(user_id, brief_date desc);
