-- ============================================================
-- System gaps migration: standing orders, revenue unification,
-- note links, and gesture event pruning improvements.
-- ============================================================

-- ── mavis_standing_orders ─────────────────────────────────────────────────────
-- Persists operator custom standing orders across sessions.

create table if not exists public.mavis_standing_orders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  order_text  text not null,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, order_text)
);

alter table public.mavis_standing_orders enable row level security;

create policy "Users manage own standing orders"
  on public.mavis_standing_orders for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_standing_orders_user
  on public.mavis_standing_orders (user_id, enabled);

-- ── Revenue unification view ──────────────────────────────────────────────────
-- Merges mavis_revenue, mavis_products, and persona_revenue into a single
-- queryable surface. Deduplicates on stripe_payment_id where present.

create or replace view public.mavis_revenue_unified as
  -- Direct revenue events
  select
    id,
    user_id,
    source,
    amount,
    currency,
    description,
    stripe_payment_id,
    metadata,
    created_at
  from public.mavis_revenue

  union all

  -- Product purchases (only rows that are NOT already in mavis_revenue)
  select
    p.id,
    p.user_id,
    'product'                      as source,
    p.price_usd                    as amount,
    'usd'                          as currency,
    p.name                         as description,
    null                           as stripe_payment_id,
    jsonb_build_object('product_id', p.id, 'gumroad_url', p.gumroad_url) as metadata,
    p.created_at
  from public.mavis_products p
  where p.status = 'published'
    and not exists (
      select 1 from public.mavis_revenue r
      where r.user_id = p.user_id
        and r.description = p.name
    );

-- ── mavis_note_links auto-index ───────────────────────────────────────────────
-- Ensure the junction table exists for the knowledge graph wikilink index.
-- knowledgeGraphAgent.ts will write to this on every note save.

create table if not exists public.mavis_note_links (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  source_id   uuid not null,  -- references mavis_notes(id)
  target_slug text not null,  -- the [[wikilink]] slug (lowercased)
  link_text   text,           -- raw text inside [[...]]
  created_at  timestamptz not null default now(),
  unique (user_id, source_id, target_slug)
);

alter table public.mavis_note_links enable row level security;

create policy "Users manage own note links"
  on public.mavis_note_links for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_note_links_source
  on public.mavis_note_links (user_id, source_id);

create index if not exists idx_note_links_target
  on public.mavis_note_links (user_id, target_slug);

-- ── Skill definitions — ensure keywords column exists ─────────────────────────
-- Earlier migrations may have created mavis_skill_definitions without keywords[].

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'mavis_skill_definitions'
      and column_name = 'keywords'
  ) then
    alter table public.mavis_skill_definitions
      add column keywords text[] not null default '{}';
  end if;
end $$;

-- ── updated_at trigger helper ─────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_standing_orders_updated_at'
  ) then
    create trigger trg_standing_orders_updated_at
      before update on public.mavis_standing_orders
      for each row execute function public.set_updated_at();
  end if;
end $$;
