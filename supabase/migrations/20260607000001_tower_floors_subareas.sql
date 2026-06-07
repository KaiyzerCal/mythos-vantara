-- Tower floors: user-editable floor data (seeded from defaults on first visit)
create table if not exists tower_floors (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        references profiles(id) on delete cascade not null,
  floor_min   integer     not null,
  floor_max   integer     not null,
  name        text        not null default '',
  law         text        not null default '',
  energy      text        not null default '',
  essence     text        not null default '',
  "function"  text        not null default '',
  ecology     text        not null default '',
  inhabitants text        not null default '',
  dangers     text        not null default '',
  rewards     text        not null default '',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique(user_id, floor_min, floor_max)
);

alter table tower_floors enable row level security;
create policy "Users manage own tower floors"
  on tower_floors for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Tower sub-areas: custom named locations within a floor range
create table if not exists tower_subareas (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        references profiles(id) on delete cascade not null,
  floor_id    uuid        references tower_floors(id) on delete cascade not null,
  name        text        not null default '',
  description text        not null default '',
  floor_start integer,
  floor_end   integer,
  area_type   text        not null default 'location',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table tower_subareas enable row level security;
create policy "Users manage own tower subareas"
  on tower_subareas for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
