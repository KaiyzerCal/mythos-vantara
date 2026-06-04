create table if not exists public.mavis_meeting_preps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null,  -- external calendar event id
  event_title text not null,
  event_start timestamptz not null,
  attendees text[] not null default '{}',
  prep_brief text not null,  -- AI-generated prep brief
  talking_points text[] not null default '{}',
  context_notes text,  -- relevant memories/notes used
  prep_sent boolean not null default false,
  created_at timestamptz not null default now(),
  unique(user_id, event_id)
);
alter table public.mavis_meeting_preps enable row level security;
create policy "Users see own preps" on public.mavis_meeting_preps for select using (auth.uid() = user_id);
create index on public.mavis_meeting_preps(user_id, event_start);
