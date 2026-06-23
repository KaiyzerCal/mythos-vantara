create table if not exists public.mavis_outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_name text not null,
  drafted_message text not null,
  status text not null default 'pending', -- 'pending','approved','skipped','sent'
  created_at timestamptz not null default now()
);
alter table public.mavis_outreach_drafts enable row level security;
create policy "Users see own drafts" on public.mavis_outreach_drafts for select using (auth.uid() = user_id);
create index on public.mavis_outreach_drafts(user_id, created_at desc);
