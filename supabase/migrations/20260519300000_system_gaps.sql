-- ============================================================
-- System gaps migration: standing orders, revenue unification,
-- note wikilink index, and skill keywords guard.
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
-- Merges mavis_revenue and mavis_products into a single queryable surface.
-- mavis_revenue columns: id, user_id, source, amount, currency, description,
--   stripe_payment_id, gumroad_sale_id, task_id, created_at
-- mavis_products columns: id, user_id, title, price_cents, status, gumroad_url,
--   stripe_product_id, stripe_price_id, created_at

create or replace view public.mavis_revenue_unified as
  -- Direct revenue events
  select
    id,
    user_id,
    source,
    amount,
    coalesce(currency, 'usd')  as currency,
    description,
    stripe_payment_id,
    null::jsonb                as metadata,
    created_at
  from public.mavis_revenue

  union all

  -- Published products not already logged as a revenue event
  select
    p.id,
    p.user_id,
    'product'                                                       as source,
    (p.price_cents / 100.0)::numeric                               as amount,
    'usd'                                                           as currency,
    p.title                                                         as description,
    p.stripe_price_id                                               as stripe_payment_id,
    jsonb_build_object(
      'product_id', p.id,
      'gumroad_url', p.gumroad_url,
      'sales_count', p.sales_count
    )                                                               as metadata,
    p.created_at
  from public.mavis_products p
  where p.status = 'published'
    and not exists (
      select 1 from public.mavis_revenue r
      where r.user_id = p.user_id
        and r.description = p.title
    );

-- ── mavis_note_wikilinks ─────────────────────────────────────────────────────
-- Slug-based wikilink index for the knowledge graph.
-- Distinct from the existing mavis_note_links table (which uses resolved UUID FKs).
-- knowledgeGraphAgent.ts writes here on every writeNote() call.

create table if not exists public.mavis_note_wikilinks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  source_note_id  uuid not null references public.mavis_notes(id) on delete cascade,
  target_slug     text not null,  -- lowercased [[wikilink]] text
  link_text       text,           -- original casing
  created_at      timestamptz not null default now(),
  unique (user_id, source_note_id, target_slug)
);

alter table public.mavis_note_wikilinks enable row level security;

create policy "Users manage own note wikilinks"
  on public.mavis_note_wikilinks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_note_wikilinks_source
  on public.mavis_note_wikilinks (user_id, source_note_id);

create index if not exists idx_note_wikilinks_target
  on public.mavis_note_wikilinks (user_id, target_slug);

-- ── Skill definitions — ensure keywords column exists ─────────────────────────

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
