-- ═══════════════════════════════════════════════════════════
-- MAVIS DESIGN ENGINE — storage for generated sites & components
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mavis_design_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  project_name text NOT NULL,
  brand text NOT NULL DEFAULT 'custom',
  project_goal text NOT NULL,
  target_audience text NOT NULL,
  key_features text[] DEFAULT '{}',
  aesthetic_directives text,
  competitor_urls text[] DEFAULT '{}',
  user_journey text,
  deadline_tier text DEFAULT 'standard'
    CHECK (deadline_tier IN ('rapid', 'standard', 'premium')),

  strategic_blueprint jsonb,
  design_system jsonb,
  generated_files jsonb,
  quality_gate_results jsonb,

  status text DEFAULT 'brief_received'
    CHECK (status IN (
      'brief_received', 'analyzing', 'designing',
      'generating', 'quality_check', 'complete', 'failed'
    )),

  client_name text,
  project_value numeric(10,2),

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mavis_design_projects_user_status
  ON mavis_design_projects(user_id, status);
CREATE INDEX IF NOT EXISTS mavis_design_projects_user_created
  ON mavis_design_projects(user_id, created_at DESC);

ALTER TABLE mavis_design_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users own design projects"
  ON mavis_design_projects FOR ALL USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════
-- DESIGN COMPONENTS — reusable component library
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mavis_design_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  project_id uuid REFERENCES mavis_design_projects(id) ON DELETE SET NULL,

  component_name text NOT NULL,
  component_type text NOT NULL
    CHECK (component_type IN (
      'hero', 'navbar', 'footer', 'cta', 'card', 'form',
      'testimonial', 'pricing', 'feature_grid', 'modal',
      'gallery', 'stats', 'faq', 'timeline', 'custom'
    )),

  tsx_code text,
  css_code text,
  props_interface text,
  storybook_story text,

  design_tokens jsonb,
  accessibility_score int,
  performance_notes text,

  is_reusable boolean DEFAULT true,
  tags text[] DEFAULT '{}',
  times_used int DEFAULT 0,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mavis_design_components_user_type
  ON mavis_design_components(user_id, component_type);
CREATE INDEX IF NOT EXISTS mavis_design_components_user_reusable
  ON mavis_design_components(user_id, is_reusable);

ALTER TABLE mavis_design_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users own design components"
  ON mavis_design_components FOR ALL USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════
-- DESIGN TOKENS — brand token library
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mavis_design_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  brand text NOT NULL DEFAULT 'codexos',
  token_set jsonb NOT NULL,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, brand)
);

ALTER TABLE mavis_design_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users own design tokens"
  ON mavis_design_tokens FOR ALL USING (auth.uid() = user_id);
