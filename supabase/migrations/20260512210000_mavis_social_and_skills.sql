-- =============================================================================
-- Section A — mavis_social_posts
-- Tracks every post Nora Vale (or any MAVIS persona) makes on social media.
-- =============================================================================

create table if not exists mavis_social_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  platform text not null default 'twitter' check (platform in ('twitter', 'instagram', 'linkedin', 'threads')),
  persona text not null default 'nora_vale',
  content text not null,
  tweet_id text,
  thread_parent_id text,
  status text not null default 'pending' check (status in ('pending', 'posted', 'failed', 'scheduled')),
  engagement jsonb default '{}',
  posted_at timestamptz,
  created_at timestamptz default now()
);
CREATE INDEX IF NOT EXISTS idx_mavis_social_posts_user ON mavis_social_posts(user_id, platform, posted_at desc);
alter table mavis_social_posts enable row level security;
DO $$ BEGIN
  create policy "users own social posts" on mavis_social_posts for all using (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- Section B — mavis_skill_definitions
-- DB-backed skills that MAVIS writes herself at runtime (prompt-based, no code
-- deploy needed).
-- =============================================================================

create table if not exists mavis_skill_definitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  description text not null,
  keywords text[] not null default '{}',
  prompt_template text not null,
  is_active boolean not null default true,
  invocation_count int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_mavis_skill_definitions_user ON mavis_skill_definitions(user_id, is_active);
alter table mavis_skill_definitions enable row level security;
DO $$ BEGIN
  create policy "users own skill definitions" on mavis_skill_definitions for all using (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- Section C — Add gumroad columns to mavis_products
-- =============================================================================

alter table mavis_products add column if not exists gumroad_product_id text;
alter table mavis_products add column if not exists gumroad_url text;
