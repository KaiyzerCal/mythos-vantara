-- ═══════════════════════════════════════════════════════════
-- MAVIS PRODUCTS
-- Tracks products created by MAVIS's autonomous product creation loop.
-- One row per product. Stripe IDs stored for webhook reconciliation.
-- ═══════════════════════════════════════════════════════════

create table if not exists mavis_products (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  title           text not null,
  description     text,
  audience        text,
  category        text default 'guide'
                    check (category in ('guide', 'prompt_pack', 'template', 'framework', 'mini_course')),
  content         text not null,
  price_cents     int not null default 2900,
  stripe_product_id text,
  stripe_price_id   text,
  payment_link    text,
  status          text not null default 'active'
                    check (status in ('draft', 'active', 'archived')),
  sales_count     int not null default 0,
  revenue_total   numeric(10,2) not null default 0,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index on mavis_products(user_id, status);
create index on mavis_products(user_id, created_at desc);

alter table mavis_products enable row level security;
create policy "users own products" on mavis_products
  for all using (auth.uid() = user_id);

create or replace function update_mavis_products_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger mavis_products_updated_at
  before update on mavis_products
  for each row execute function update_mavis_products_updated_at();
