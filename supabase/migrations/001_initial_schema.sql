-- ============================================================
-- VANTARA.EXE — Initial Database Migration
-- Migrated from Rork GameState → Supabase (Lovable pattern)
-- ============================================================

-- ENUM
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('owner', 'user');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- PROFILES (core character / operator identity)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Identity
  inscribed_name text NOT NULL DEFAULT 'Black Sun Monarch',
  true_name text,
  titles text[] NOT NULL DEFAULT ARRAY['The Architect', 'Sovereign of CODEXOS'],
  species_lineage text[] NOT NULL DEFAULT ARRAY['Codicanthropos Dominus'],
  aura text NOT NULL DEFAULT 'Emerald Sovereign Aura',
  territory_class text NOT NULL DEFAULT 'Sovereign',
  territory_floors text NOT NULL DEFAULT 'Floors 1–100',
  arc_story text NOT NULL DEFAULT 'Forge of Equilibrium (Phase III Evolution)',

  -- Stats
  level integer NOT NULL DEFAULT 54,
  xp integer NOT NULL DEFAULT 0,
  xp_to_next_level integer NOT NULL DEFAULT 3000,
  rank text NOT NULL DEFAULT 'B',
  stat_str integer NOT NULL DEFAULT 72,
  stat_agi integer NOT NULL DEFAULT 68,
  stat_vit integer NOT NULL DEFAULT 75,
  stat_int integer NOT NULL DEFAULT 95,
  stat_wis integer NOT NULL DEFAULT 88,
  stat_cha integer NOT NULL DEFAULT 82,
  stat_lck integer NOT NULL DEFAULT 65,
  aura_power text NOT NULL DEFAULT 'Emerald Flames',
  fatigue integer NOT NULL DEFAULT 0,
  full_cowl_sync integer NOT NULL DEFAULT 92,
  codex_integrity integer NOT NULL DEFAULT 97,

  -- State
  current_form text NOT NULL DEFAULT 'CodexOS Architect Mode',
  current_bpm integer NOT NULL DEFAULT 72,
  current_floor integer NOT NULL DEFAULT 54,
  gpr integer NOT NULL DEFAULT 8847,
  pvp_rating integer NOT NULL DEFAULT 2240,

  -- Meta
  onboarding_done boolean NOT NULL DEFAULT false,
  display_name text,
  operator_level integer NOT NULL DEFAULT 1,
  operator_xp integer NOT NULL DEFAULT 0,
  notification_settings jsonb NOT NULL DEFAULT '{
    "questReminders": true,
    "streakWarnings": true,
    "xpMilestones": false,
    "dailySummary": true
  }'::jsonb
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- QUESTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.quests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'daily',   -- main | side | daily | epic
  status text NOT NULL DEFAULT 'active', -- active | completed | failed | locked
  difficulty text NOT NULL DEFAULT 'Normal',
  xp_reward integer NOT NULL DEFAULT 100,
  codex_points_reward integer NOT NULL DEFAULT 0,
  progress_current integer NOT NULL DEFAULT 0,
  progress_target integer NOT NULL DEFAULT 1,
  real_world_mapping text,
  category text,
  deadline timestamptz,
  loot_rewards jsonb NOT NULL DEFAULT '[]'::jsonb,
  linked_skill_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own quests" ON public.quests FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- SKILLS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'General',
  energy_type text NOT NULL DEFAULT 'Emerald Flames',
  tier integer NOT NULL DEFAULT 1,
  unlocked boolean NOT NULL DEFAULT true,
  cost integer NOT NULL DEFAULT 0,
  proficiency integer NOT NULL DEFAULT 0,
  prerequisites text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own skills" ON public.skills FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- TASKS & HABITS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  type text NOT NULL DEFAULT 'task',           -- task | habit
  status text NOT NULL DEFAULT 'active',        -- active | completed | archived
  recurrence text NOT NULL DEFAULT 'once',      -- once | daily | weekly | monthly
  xp_reward integer NOT NULL DEFAULT 25,
  linked_skill_id uuid,
  streak integer NOT NULL DEFAULT 0,
  completed_count integer NOT NULL DEFAULT 0,
  last_completed timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own tasks" ON public.tasks FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- TRANSFORMATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.transformations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tier text NOT NULL,
  name text NOT NULL,
  form_order integer NOT NULL DEFAULT 0,
  bpm_range text NOT NULL DEFAULT '0–200',
  category text,
  description text,
  energy text NOT NULL DEFAULT 'Emerald Flames',
  jjk_grade text NOT NULL DEFAULT 'Special Grade',
  op_tier text NOT NULL DEFAULT 'God Tier',
  active_buffs jsonb NOT NULL DEFAULT '[]'::jsonb,
  passive_buffs jsonb NOT NULL DEFAULT '[]'::jsonb,
  abilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  unlocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.transformations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own transformations" ON public.transformations FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- ENERGY SYSTEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.energy_systems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  current_value integer NOT NULL DEFAULT 100,
  max_value integer NOT NULL DEFAULT 100,
  color text NOT NULL DEFAULT '#08C284',
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'developing',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.energy_systems ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own energy" ON public.energy_systems FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- COUNCILS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.councils (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'Member',
  specialty text,
  class text NOT NULL DEFAULT 'advisory', -- core | advisory | think-tank | shadows
  notes text NOT NULL DEFAULT '',
  avatar text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.councils ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own councils" ON public.councils FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- INVENTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS public.inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'equipment',
  rarity text NOT NULL DEFAULT 'common',
  quantity integer NOT NULL DEFAULT 1,
  effect text,
  slot text,
  tier text,
  stat_effects jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_equipped boolean NOT NULL DEFAULT false,
  obtained_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own inventory" ON public.inventory FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- CURRENCIES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.currencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  amount integer NOT NULL DEFAULT 0,
  icon text NOT NULL DEFAULT '💎',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own currencies" ON public.currencies FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- JOURNAL ENTRIES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  category text NOT NULL DEFAULT 'personal',
  importance text NOT NULL DEFAULT 'medium',
  mood text,
  xp_earned integer NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own journal entries" ON public.journal_entries FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- VAULT ENTRIES (legal/business/evidence codex)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.vault_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'personal',  -- legal | business | personal | evidence | achievement
  importance text NOT NULL DEFAULT 'medium',  -- low | medium | high | critical
  attachments text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vault_entries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own vault entries" ON public.vault_entries FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- ALLIES & ROSTER
-- ============================================================
CREATE TABLE IF NOT EXISTS public.allies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  relationship text NOT NULL DEFAULT 'ally',  -- ally | council | rival
  level integer NOT NULL DEFAULT 1,
  specialty text NOT NULL DEFAULT 'General',
  affinity integer NOT NULL DEFAULT 50,
  avatar text,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.allies ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own allies" ON public.allies FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- BPM SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bpm_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  bpm integer NOT NULL,
  form text NOT NULL DEFAULT 'Base',
  duration integer NOT NULL DEFAULT 0,
  mood text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bpm_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own bpm sessions" ON public.bpm_sessions FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- RITUALS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rituals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'other',
  category text,
  xp_reward integer NOT NULL DEFAULT 25,
  completed boolean NOT NULL DEFAULT false,
  streak integer NOT NULL DEFAULT 0,
  last_completed timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rituals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own rituals" ON public.rituals FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- CHAT CONVERSATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'New Conversation',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own conversations" ON public.chat_conversations FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- CHAT MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'user',
  content text NOT NULL,
  mode text DEFAULT 'PRIME',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own messages" ON public.chat_messages FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- ACTIVITY LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_type text NOT NULL,
  description text NOT NULL,
  xp_amount integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own activity log" ON public.activity_log FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- USER ROLES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users can read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- TRIGGER: auto-create profile on signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
