-- ═══════════════════════════════════════════════════════════
-- MAVIS THREE-LAYER MEMORY SYSTEM
-- Layer 1: mavis_knowledge (PARA knowledge graph)
-- Layer 2: mavis_memory (session logs)
-- Layer 3: mavis_tacit (operator preferences / hard rules)
-- Plus: mavis_tasks, mavis_revenue, mavis_consolidation_log
-- ═══════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- LAYER 2: Session logs (conversation history)
-- ─────────────────────────────────────────────────────────────
create table if not exists mavis_memory (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        references auth.users(id) on delete cascade not null,
  session_id      text        not null,
  role            text        not null check (role in ('user', 'assistant', 'system')),
  content         text        not null,
  timestamp       bigint      not null,
  importance_score int        default 5,
  consolidated    boolean     default false,
  created_at      timestamptz default now()
);

create index if not exists idx_mavis_memory_user_session   on mavis_memory(user_id, session_id);
create index if not exists idx_mavis_memory_user_timestamp on mavis_memory(user_id, timestamp desc);
create index if not exists idx_mavis_memory_consolidated   on mavis_memory(user_id, consolidated);

alter table mavis_memory enable row level security;

DO $$ BEGIN
  create policy "users own memory"
    on mavis_memory for all
    using (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────
-- LAYER 1: Knowledge graph (PARA — Projects/Areas/Resources/Archives)
-- ─────────────────────────────────────────────────────────────
create table if not exists mavis_knowledge (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        references auth.users(id) on delete cascade not null,
  category         text        not null check (category in ('project', 'area', 'resource', 'archive')),
  title            text        not null,
  content          text        not null,
  tags             text[]      default '{}',
  related_ids      uuid[]      default '{}',
  last_referenced  timestamptz default now(),
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  unique(user_id, title)
);

create index if not exists idx_mavis_knowledge_user_category on mavis_knowledge(user_id, category);
create index if not exists idx_mavis_knowledge_user_title    on mavis_knowledge(user_id, title);

alter table mavis_knowledge enable row level security;

DO $$ BEGIN
  create policy "users own knowledge"
    on mavis_knowledge for all
    using (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────
-- LAYER 3: Tacit knowledge (operator preferences, hard rules, lessons)
-- ─────────────────────────────────────────────────────────────
create table if not exists mavis_tacit (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        references auth.users(id) on delete cascade not null,
  category   text        not null check (category in (
               'preference', 'hard_rule', 'lesson_learned',
               'workflow_habit', 'communication_style', 'standing_order'
             )),
  key        text        not null,
  value      text        not null,
  source     text,
  confidence int         default 5 check (confidence between 1 and 10),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, key)
);

create index if not exists idx_mavis_tacit_user_category on mavis_tacit(user_id, category);

alter table mavis_tacit enable row level security;

DO $$ BEGIN
  create policy "users own tacit"
    on mavis_tacit for all
    using (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────
-- TASK LEDGER (autonomous operations — operator visibility)
-- ─────────────────────────────────────────────────────────────
create table if not exists mavis_tasks (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        references auth.users(id) on delete cascade not null,
  type         text        not null,
  description  text,
  payload      jsonb       default '{}',
  status       text        not null default 'pending'
               check (status in ('pending','running','completed','failed','cancelled','requires_confirmation')),
  scheduled_at timestamptz,
  started_at   timestamptz,
  completed_at timestamptz,
  result       jsonb,
  revenue_generated numeric(10,2) default 0,
  created_at   timestamptz default now()
);

create index if not exists idx_mavis_tasks_user_status    on mavis_tasks(user_id, status);
create index if not exists idx_mavis_tasks_user_scheduled on mavis_tasks(user_id, scheduled_at);

alter table mavis_tasks enable row level security;

DO $$ BEGIN
  create policy "users own tasks"
    on mavis_tasks for all
    using (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────
-- REVENUE LEDGER (Felix-equivalent income tracking)
-- ─────────────────────────────────────────────────────────────
create table if not exists mavis_revenue (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        references auth.users(id) on delete cascade not null,
  source            text        not null,
  amount            numeric(10,2) not null,
  currency          text        default 'USD',
  description       text,
  stripe_payment_id text,
  task_id           uuid        references mavis_tasks(id),
  created_at        timestamptz default now()
);

create index if not exists idx_mavis_revenue_user_created on mavis_revenue(user_id, created_at desc);

alter table mavis_revenue enable row level security;

DO $$ BEGIN
  create policy "users own revenue"
    on mavis_revenue for all
    using (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────
-- NIGHTLY CONSOLIDATION LOG
-- ─────────────────────────────────────────────────────────────
create table if not exists mavis_consolidation_log (
  id                        uuid   primary key default gen_random_uuid(),
  user_id                   uuid   references auth.users(id) on delete cascade not null,
  session_date              date   not null,
  messages_processed        int    default 0,
  knowledge_entries_created int    default 0,
  tacit_entries_created     int    default 0,
  summary                   text,
  created_at                timestamptz default now()
);

alter table mavis_consolidation_log enable row level security;

DO $$ BEGIN
  create policy "users own consolidation log"
    on mavis_consolidation_log for all
    using (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
