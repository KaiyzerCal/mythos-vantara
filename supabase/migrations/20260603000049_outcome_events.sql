create table if not exists public.mavis_outcome_events (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  source_type        text not null,  -- 'prediction','recommendation','outreach','meeting_prep','recovery_plan','opportunity','causal_action'
  source_id          uuid,           -- reference to originating row (nullable for manual entries)
  prediction_text    text not null,  -- what was predicted or recommended
  predicted_outcome  text,           -- expected result
  actual_outcome     text,           -- filled by tracker after checking
  outcome_status     text not null default 'pending',  -- 'pending','confirmed','failed','partial','expired'
  confidence_score   numeric(3,2),   -- 0-1 how accurate was this
  evidence_data      jsonb default '{}'::jsonb,
  due_check_at       timestamptz not null default now() + interval '3 days',
  checked_at         timestamptz,
  created_at         timestamptz not null default now()
);
alter table public.mavis_outcome_events enable row level security;
create policy "Users see own outcomes" on public.mavis_outcome_events for select using (auth.uid() = user_id);
create index on public.mavis_outcome_events(user_id, outcome_status, due_check_at);
create index on public.mavis_outcome_events(user_id, source_type, created_at desc);
