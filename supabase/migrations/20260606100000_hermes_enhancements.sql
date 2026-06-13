-- ============================================================
-- MAVIS Hermes Enhancement Suite
-- Inspired by the Hermes Agent (NousResearch) open-source pattern:
-- USER.md behavioral model, curator loop, Ralph loop, domain playbooks,
-- standing order templates, behavioral XP triggers.
-- ============================================================

-- 1. mavis_user_model — AI-synthesized behavioral model (USER.md pattern)
--    Refreshed daily by mavis-user-model-refresh edge function.
--    Injected into every chat turn as <memory-context> block.
CREATE TABLE IF NOT EXISTS public.mavis_user_model (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  personality_summary   TEXT,
  communication_style   JSONB DEFAULT '{}',
  decision_patterns     JSONB DEFAULT '{}',
  core_values           TEXT[] DEFAULT '{}',
  primary_goals         TEXT[] DEFAULT '{}',
  working_style         JSONB DEFAULT '{}',
  triggers              JSONB DEFAULT '{}',
  raw_synthesis         TEXT,
  last_synthesized_at   TIMESTAMPTZ DEFAULT NOW(),
  synthesis_version     INT DEFAULT 1,
  session_count         INT DEFAULT 0,
  confidence_score      FLOAT DEFAULT 0.1,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);
ALTER TABLE public.mavis_user_model ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage their user model" ON public.mavis_user_model
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. standing_order_templates — reusable procedure templates (curator lifecycle)
CREATE TABLE IF NOT EXISTS public.standing_order_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slug             TEXT NOT NULL,
  name             TEXT NOT NULL,
  description      TEXT,
  instructions     TEXT NOT NULL,
  category         TEXT DEFAULT 'general',
  version          INT DEFAULT 1,
  status           TEXT DEFAULT 'active' CHECK (status IN ('active','archived','pinned')),
  usage_count      INT DEFAULT 0,
  success_count    INT DEFAULT 0,
  last_used_at     TIMESTAMPTZ,
  next_run_at      TIMESTAMPTZ,
  cron_expression  TEXT,
  created_by_agent BOOLEAN DEFAULT FALSE,
  tags             TEXT[] DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, slug)
);
ALTER TABLE public.standing_order_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage their SO templates" ON public.standing_order_templates
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. mavis_so_executions — execution history for standing order runs
CREATE TABLE IF NOT EXISTS public.mavis_so_executions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id    UUID REFERENCES public.standing_order_templates(id) ON DELETE SET NULL,
  template_slug  TEXT,
  status         TEXT DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  result         TEXT,
  error_message  TEXT,
  turns_used     INT DEFAULT 0,
  started_at     TIMESTAMPTZ DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,
  triggered_by   TEXT DEFAULT 'manual',
  metadata       JSONB DEFAULT '{}'
);
ALTER TABLE public.mavis_so_executions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users view their SO executions" ON public.mavis_so_executions
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. mavis_playbooks — domain procedure libraries (Finance, Research, Creative, Health)
CREATE TABLE IF NOT EXISTS public.mavis_playbooks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  domain      TEXT NOT NULL,
  description TEXT,
  procedures  JSONB DEFAULT '[]',
  is_system   BOOLEAN DEFAULT FALSE,
  is_active   BOOLEAN DEFAULT TRUE,
  version     INT DEFAULT 1,
  usage_count INT DEFAULT 0,
  tags        TEXT[] DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(slug)
);
ALTER TABLE public.mavis_playbooks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users see system playbooks and their own" ON public.mavis_playbooks
    FOR SELECT USING (is_system = TRUE OR auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Users manage their own playbooks" ON public.mavis_playbooks
    FOR ALL USING (auth.uid() = user_id AND is_system = FALSE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. mavis_goal_judge_log — Ralph loop execution log
CREATE TABLE IF NOT EXISTS public.mavis_goal_judge_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_id             UUID,
  goal_objective      TEXT,
  turn_number         INT DEFAULT 1,
  judge_verdict       BOOLEAN DEFAULT FALSE,
  judge_reason        TEXT,
  continuation_prompt TEXT,
  ai_response         TEXT,
  max_turns           INT DEFAULT 20,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.mavis_goal_judge_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users view their goal judge logs" ON public.mavis_goal_judge_log
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6. Seed domain playbooks (system-level, not user-owned)
INSERT INTO public.mavis_playbooks (slug, name, domain, description, procedures, is_system, version) VALUES
(
  'finance-fundamentals',
  'Finance Fundamentals',
  'finance',
  'Core financial analysis: DCF valuation, comparable analysis, budget modeling, cash flow optimization.',
  '[
    {"name":"DCF Valuation","description":"Discounted cash flow analysis for any asset or business","prompt_template":"Perform a DCF valuation for {asset_name}. Use: {assumptions}. Calculate NPV, IRR, and sensitivity on key variables. Present in a clear table.","tags":["valuation","investing"]},
    {"name":"Comparable Company Analysis","description":"Benchmark against peers using market multiples","prompt_template":"Comparable company analysis for {company_name}. Research {num_peers} peers. Compare: EV/EBITDA, P/E, P/S, EV/Revenue. Identify where {company_name} is under/over-valued.","tags":["valuation","comps"]},
    {"name":"Personal Budget Model","description":"Monthly budget planning and variance analysis","prompt_template":"Create a monthly budget model. Fixed income: {income}. Fixed expenses: {fixed_expenses}. Variable targets: {variable_targets}. Calculate savings rate, flag risks, identify optimizations.","tags":["budgeting","personal-finance"]},
    {"name":"Cash Flow Optimizer","description":"30-60-90 day cash flow planning","prompt_template":"Analyze cash flow situation. Current balance: {current_balance}. Expected inflows 90 days: {inflows}. Known outflows: {outflows}. Create 30-60-90 day forecast, identify gaps and timing opportunities.","tags":["cash-flow","planning"]}
  ]'::JSONB,
  TRUE, 1
),
(
  'research-toolkit',
  'Research Toolkit',
  'research',
  'Structured research: competitive intelligence, market sizing, source triangulation, synthesis frameworks.',
  '[
    {"name":"Competitor Deep Dive","description":"Comprehensive competitor analysis","prompt_template":"Deep competitive analysis of {competitor_name}. Cover: (1) Product/service and positioning, (2) Pricing, (3) Target customer, (4) Revenue metrics, (5) Strengths and vulnerabilities, (6) Recent strategic moves. Synthesize into 1-page intelligence brief.","tags":["competitive-intel"]},
    {"name":"Market Sizing (TAM/SAM/SOM)","description":"Bottom-up and top-down market estimation","prompt_template":"Calculate market size for {market_name}. Use both bottom-up and top-down approaches. Define TAM, SAM, SOM. Cite assumptions and sources. Conclude with confidence rating.","tags":["market-research","sizing"]},
    {"name":"Source Triangulation","description":"Verify a claim across 3+ independent sources","prompt_template":"Verify: \"{claim}\". Research at least 3 independent sources. For each: (1) Identify, (2) Assess credibility, (3) What it says. Render verdict: Confirmed / Partially / Disputed / Unverified.","tags":["fact-check"]},
    {"name":"Research Synthesis","description":"Distill multiple sources into a structured brief","prompt_template":"Synthesize research on {topic}: {research_notes}. Structure: (1) Key Findings, (2) Points of Consensus, (3) Points of Debate, (4) Knowledge Gaps, (5) Next Steps.","tags":["synthesis"]}
  ]'::JSONB,
  TRUE, 1
),
(
  'creative-engine',
  'Creative Engine',
  'creative',
  'Brand voice, content strategy, and creative production procedures.',
  '[
    {"name":"Brand Voice Generator","description":"Define and codify your unique brand voice","prompt_template":"Define brand voice for {brand_name}. Audience: {audience}. Values: {values}. Differentiate from: {competitors}. Produce: (1) Voice pillars with descriptions, (2) Do/Don''t examples, (3) Sample headline, (4) Words to always use, (5) Words to never use.","tags":["branding","voice"]},
    {"name":"Content Calendar Builder","description":"30-day content plan across platforms","prompt_template":"Build 30-day content calendar for {brand_name}. Platforms: {platforms}. Pillars: {pillars}. Frequency: {frequency}. For each piece: date, platform, type, hook, key message, CTA.","tags":["content","calendar"]},
    {"name":"Hook Architect","description":"Write 10 high-converting hooks","prompt_template":"Write 10 hooks for content about: {topic}. Audience: {audience}. Use each format once: curiosity gap, contrarian, stat, story, how-to, warning, listicle, question, bold claim, transformation. Mark top 3.","tags":["copywriting","hooks"]},
    {"name":"Repurpose Engine","description":"Transform one content piece into 5+ formats","prompt_template":"Repurpose this content: {original_content}. Create: (1) Twitter/X thread 8-12 tweets, (2) LinkedIn article 300-500 words, (3) 60-second video script, (4) Email newsletter section, (5) Instagram caption with hashtags.","tags":["repurposing"]}
  ]'::JSONB,
  TRUE, 1
),
(
  'health-protocol',
  'Health Protocol',
  'health',
  'Evidence-based health optimization: workout programming, nutrition planning, recovery, biometric analysis.',
  '[
    {"name":"Workout Program Design","description":"Periodized training program","prompt_template":"Design {duration}-week training program. Goal: {goal}. Fitness level: {fitness_level}. Equipment: {equipment}. Time/session: {time_available}. Include: weekly structure, progressive overload, deload week, metrics to track.","tags":["training","fitness"]},
    {"name":"Nutrition Blueprint","description":"Macro and meal planning for performance","prompt_template":"Nutrition blueprint for {goal}. Stats: weight {weight}, height {height}, activity {activity_level}. Preferences: {preferences}. Calculate: TDEE, target macros, caloric targets (training vs rest). Include 3 sample day meal plans.","tags":["nutrition"]},
    {"name":"Recovery Protocol","description":"Optimize sleep and recovery from biometrics","prompt_template":"Recovery analysis. HRV: {hrv}. Sleep efficiency: {sleep_efficiency}%. Resting HR: {resting_hr}. Readiness: {readiness}. Identify: (1) Recovery status, (2) Limiting factors, (3) Interventions to improve HRV/sleep, (4) Activity modifications for low-readiness days.","tags":["recovery","sleep"]},
    {"name":"Health Goal Decomposer","description":"Break health goals into trackable milestones","prompt_template":"Decompose health goal: {health_goal}. Timeline: {timeline}. Create week-by-week progression with targets, habits, metrics, warning signs. Format as table.","tags":["goal-setting","health"]}
  ]'::JSONB,
  TRUE, 1
)
ON CONFLICT (slug) DO NOTHING;

-- 7. updated_at triggers (only create if set_updated_at function exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_mavis_user_model_updated_at') THEN
      CREATE TRIGGER set_mavis_user_model_updated_at
        BEFORE UPDATE ON public.mavis_user_model
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_standing_order_templates_updated_at') THEN
      CREATE TRIGGER set_standing_order_templates_updated_at
        BEFORE UPDATE ON public.standing_order_templates
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_mavis_playbooks_updated_at') THEN
      CREATE TRIGGER set_mavis_playbooks_updated_at
        BEFORE UPDATE ON public.mavis_playbooks
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    END IF;
  END IF;
END $$;

-- 8. Register cron jobs in mavis_cron_config (processed by mavis-cron-setup)
INSERT INTO mavis_cron_config (job_name, edge_function, schedule, payload) VALUES
  ('mavis-user-model-refresh', 'mavis-user-model-refresh', '0 3 * * *',   '{"trigger":"cron"}'),
  ('mavis-so-curator',          'mavis-so-curator',          '0 2 * * 0',   '{"trigger":"cron"}'),
  ('mavis-goal-judge-review',   'mavis-goal-judge',          '*/10 * * * *','{"trigger":"cron","mode":"review_active"}')
ON CONFLICT (job_name) DO NOTHING;
