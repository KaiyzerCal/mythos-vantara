-- Teams / shared workspace
CREATE TABLE IF NOT EXISTS mavis_teams (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid REFERENCES auth.users NOT NULL,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  plan text NOT NULL DEFAULT 'starter',  -- starter | pro | enterprise
  settings jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE mavis_teams ENABLE ROW LEVEL SECURITY;

-- Team members — join table linking users to teams with roles
CREATE TABLE IF NOT EXISTS mavis_team_members (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id uuid REFERENCES mavis_teams NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,
  role text NOT NULL DEFAULT 'member',  -- owner | admin | member | viewer
  invited_by uuid REFERENCES auth.users,
  joined_at timestamptz DEFAULT now(),
  UNIQUE(team_id, user_id)
);

ALTER TABLE mavis_team_members ENABLE ROW LEVEL SECURITY;

-- Shared team memory — conversation/memory entries visible to the whole team
CREATE TABLE IF NOT EXISTS mavis_team_memory (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id uuid REFERENCES mavis_teams NOT NULL,
  author_id uuid REFERENCES auth.users NOT NULL,
  role text NOT NULL DEFAULT 'user',
  content text NOT NULL,
  importance_score integer DEFAULT 5,
  tags text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE mavis_team_memory ENABLE ROW LEVEL SECURITY;

-- RLS: mavis_teams — owners can do everything; members can read their team
DO $$ BEGIN
  CREATE POLICY "team owner full access" ON mavis_teams FOR ALL
    USING (auth.uid() = owner_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "team members can read team" ON mavis_teams FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM mavis_team_members
        WHERE mavis_team_members.team_id = mavis_teams.id
          AND mavis_team_members.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RLS: mavis_team_members — owners/admins manage membership; all members can read
DO $$ BEGIN
  CREATE POLICY "team members can read membership" ON mavis_team_members FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM mavis_team_members tm
        WHERE tm.team_id = mavis_team_members.team_id
          AND tm.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "team owners admins manage members" ON mavis_team_members FOR ALL
    USING (
      EXISTS (
        SELECT 1 FROM mavis_team_members tm
        WHERE tm.team_id = mavis_team_members.team_id
          AND tm.user_id = auth.uid()
          AND tm.role IN ('owner', 'admin')
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RLS: mavis_team_memory — all team members can read; owners/admins can manage all; members/authors manage own
DO $$ BEGIN
  CREATE POLICY "team members read team memory" ON mavis_team_memory FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM mavis_team_members
        WHERE mavis_team_members.team_id = mavis_team_memory.team_id
          AND mavis_team_members.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "team members insert own memory" ON mavis_team_memory FOR INSERT
    WITH CHECK (
      auth.uid() = author_id
      AND EXISTS (
        SELECT 1 FROM mavis_team_members
        WHERE mavis_team_members.team_id = mavis_team_memory.team_id
          AND mavis_team_members.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "team owners admins manage all memory" ON mavis_team_memory FOR ALL
    USING (
      EXISTS (
        SELECT 1 FROM mavis_team_members
        WHERE mavis_team_members.team_id = mavis_team_memory.team_id
          AND mavis_team_members.user_id = auth.uid()
          AND mavis_team_members.role IN ('owner', 'admin')
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Indexes: mavis_teams
DO $$ BEGIN
  CREATE INDEX idx_mavis_teams_owner ON mavis_teams(owner_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Indexes: mavis_team_members
DO $$ BEGIN
  CREATE INDEX idx_mavis_team_members_team ON mavis_team_members(team_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_mavis_team_members_user ON mavis_team_members(user_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Indexes: mavis_team_memory
DO $$ BEGIN
  CREATE INDEX idx_mavis_team_memory_team ON mavis_team_memory(team_id, created_at DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_mavis_team_memory_author ON mavis_team_memory(author_id, created_at DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;
