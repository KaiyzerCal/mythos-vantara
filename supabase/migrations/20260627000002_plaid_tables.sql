-- ── Plaid integration tables ────────────────────────────────────────────────

-- plaid_items: one row per bank connection
create table if not exists plaid_items (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        references auth.users not null,
  item_id          text        not null unique,
  access_token     text        not null,
  institution_name text        not null default '',
  status           text        not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table plaid_items enable row level security;
create policy "owner_all" on plaid_items for all using (auth.uid() = user_id);

-- plaid_accounts: individual accounts under each item
create table if not exists plaid_accounts (
  id            uuid    primary key default gen_random_uuid(),
  user_id       uuid    references auth.users not null,
  item_id       text    not null references plaid_items(item_id) on delete cascade,
  account_id    text    not null unique,
  name          text    not null,
  official_name text,
  type          text,
  subtype       text,
  mask          text,
  current_bal   numeric,
  available_bal numeric,
  currency      text    not null default 'USD',
  updated_at    timestamptz not null default now()
);
alter table plaid_accounts enable row level security;
create policy "owner_all" on plaid_accounts for all using (auth.uid() = user_id);

-- plaid_transactions: raw transaction ledger
create table if not exists plaid_transactions (
  id             uuid    primary key default gen_random_uuid(),
  user_id        uuid    references auth.users not null,
  item_id        text    not null,
  transaction_id text    not null unique,
  account_id     text    not null,
  name           text    not null,
  merchant_name  text,
  amount         numeric not null,
  currency       text    not null default 'USD',
  date           date    not null,
  category       text    not null default 'other',
  pending        boolean not null default false,
  raw            jsonb   not null default '{}',
  created_at     timestamptz not null default now()
);
alter table plaid_transactions enable row level security;
create policy "owner_all" on plaid_transactions for all using (auth.uid() = user_id);
create index idx_plaid_txn_user_date on plaid_transactions (user_id, date desc);

-- plaid_sync_cursors: tracks the /transactions/sync cursor per item
create table if not exists plaid_sync_cursors (
  item_id    text primary key references plaid_items(item_id) on delete cascade,
  cursor     text not null,
  updated_at timestamptz not null default now()
);

-- mavis_expenses unique constraint for Plaid dedup
DO $$ BEGIN
  ALTER TABLE mavis_expenses
    ADD CONSTRAINT mavis_expenses_dedup
    UNIQUE (user_id, description, expense_date, amount);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
