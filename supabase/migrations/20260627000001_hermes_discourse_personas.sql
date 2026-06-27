-- ── Hermes-style persistent user profile ──────────────────────────────
-- Stores an evolving Markdown profile of the user (communication style,
-- key context, preferences) injected into MAVIS's system prompt each session.
create table if not exists mavis_user_profile (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        references auth.users not null unique,
  profile_md          text        not null default '',
  communication_style text        not null default '',
  key_context         text        not null default '',
  preferences         jsonb       not null default '{}',
  topics_of_interest  text[]      not null default '{}',
  updated_at          timestamptz not null default now()
);

alter table mavis_user_profile enable row level security;
create policy "owner_all" on mavis_user_profile for all using (auth.uid() = user_id);

-- Auto-update updated_at on write
create or replace function update_user_profile_timestamp()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger trg_user_profile_ts
  before update on mavis_user_profile
  for each row execute function update_user_profile_timestamp();

-- ── ElizaOS-style character fields on personas ─────────────────────────
-- bio: 1-3 sentence overview shown to the persona itself
-- lore: bullet-point backstory facts ("grew up in Tokyo", "survived a betrayal at 23")
-- knowledge_domains: topics the persona knows deeply
-- message_examples: [{user: "...", persona: "..."}, ...] — in-context few-shot examples
-- adjectives: personality descriptors used in cold-start responses
-- topics: subjects this persona gravitates toward in conversation
-- character_config: arbitrary JSON (catchphrases, speaking patterns, etc.)
alter table personas add column if not exists bio                text        not null default '';
alter table personas add column if not exists lore               text[]      not null default '{}';
alter table personas add column if not exists knowledge_domains  text[]      not null default '{}';
alter table personas add column if not exists message_examples   jsonb       not null default '[]';
alter table personas add column if not exists adjectives         text[]      not null default '{}';
alter table personas add column if not exists topics             text[]      not null default '{}';
alter table personas add column if not exists character_config   jsonb       not null default '{}';

-- ── MoltBook-style council discourse table ──────────────────────────────
-- Records structured AI-to-AI debates: positions → challenges → synthesis
create table if not exists mavis_council_discourse (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        references auth.users not null,
  topic        text        not null,
  participants jsonb       not null default '[]',
  rounds       jsonb       not null default '[]',
  synthesis    text,
  status       text        not null default 'active',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table mavis_council_discourse enable row level security;
create policy "owner_all" on mavis_council_discourse for all using (auth.uid() = user_id);
create index idx_council_discourse_user on mavis_council_discourse (user_id, created_at desc);
