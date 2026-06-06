create table if not exists public.mavis_autonomy_settings (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  action_type      text not null,
  tier             text not null default 'approve',  -- 'auto','queue','approve'
  approval_count   integer not null default 0,
  rejection_count  integer not null default 0,
  last_action_at   timestamptz not null default now(),
  unique(user_id, action_type)
);
alter table public.mavis_autonomy_settings enable row level security;
create policy "Users see own autonomy" on public.mavis_autonomy_settings for select using (auth.uid() = user_id);

-- Insert default conservative settings for all action types
-- (will be created on first use if not present)
