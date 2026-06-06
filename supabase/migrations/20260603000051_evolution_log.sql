create table if not exists public.mavis_evolution_log (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  evolution_type   text not null,  -- 'rule_strengthened','rule_weakened','rule_added','rule_pruned','pattern_discovered'
  affected_key     text,           -- mavis_tacit key that was changed
  old_value        text,
  new_value        text,
  old_confidence   numeric(3,2),
  new_confidence   numeric(3,2),
  reason           text not null,
  evidence         text,
  created_at       timestamptz not null default now()
);
alter table public.mavis_evolution_log enable row level security;
create policy "Users see own evolution" on public.mavis_evolution_log for select using (auth.uid() = user_id);
create index on public.mavis_evolution_log(user_id, created_at desc);
