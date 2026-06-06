create table if not exists public.mavis_action_queue (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  action_type         text not null,  -- 'create_task','send_notification','update_quest','create_note','draft_email','schedule_event','send_message','make_call'
  action_payload      jsonb not null default '{}'::jsonb,
  autonomy_tier       text not null default 'approve',  -- 'auto','queue','approve'
  status              text not null default 'pending',  -- 'pending','approved','rejected','executed','failed','expired'
  priority            integer not null default 5,        -- 1=critical, 10=low
  source_system       text,   -- which Mavis subsystem created this
  source_context      text,   -- why this action was created (human-readable)
  telegram_message_id text,   -- for tracking sent approval messages
  approved_at         timestamptz,
  executed_at         timestamptz,
  result_data         jsonb,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null default now() + interval '48 hours'
);
alter table public.mavis_action_queue enable row level security;
create policy "Users see own actions" on public.mavis_action_queue for select using (auth.uid() = user_id);
create index on public.mavis_action_queue(user_id, status, autonomy_tier, created_at);
