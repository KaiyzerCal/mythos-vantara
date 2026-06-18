-- ═══════════════════════════════════════════════════════════
-- BlaQOut Studio Expansion — MAVIS Shard Seed
-- MAVIS_SHARD_BLAQOUT_NSFW_STRAT v1.0
--
-- HOW TO USE:
--   Paste into Supabase Dashboard → SQL Editor and run.
--   Your user ID is detected automatically.
-- ═══════════════════════════════════════════════════════════

DO $$
DECLARE
  v_uid uuid := (SELECT id FROM auth.users LIMIT 1);
  v_now timestamptz := now();
BEGIN

-- ─────────────────────────────────────────────────────────
-- KNOWLEDGE GRAPH NOTE — full shard archived
-- ─────────────────────────────────────────────────────────
INSERT INTO public.mavis_notes (
  user_id, title, content, tags, aliases, properties, created_at, updated_at
) VALUES (
  v_uid,
  'MAVIS_SHARD: BlaQOut Studio Expansion Strategy',
  E'## BlaQOut Studio — Digital Content Expansion\n## MAVIS_SHARD_BLAQOUT_NSFW_STRAT v1.0 | May 2026\n\n### CONTEXT\nBlaQOut Studio is expanding into the adult digital content and conversational AI market. This shard outlines the phased strategy.\n\n**Current Stack Assessment:**\n- LLMs (Claude, OpenAI): SFW-focused, restricted for explicit content\n- MAVIS / n8n / ALFRED: Orchestration, persona management, automation\n- Image/Video: Leonardo.Ai, Midjourney, HeyGen, Kling, CapCut, Tavus — SFW\n\n**Core Finding:** The CODEXOS framework is well-suited to manage workflows and integrations. The primary gap is access to less-restricted generation models for adult content.\n\n---\n\n### PHASE 1 — Foundation & Legal (CRITICAL PRIORITY)\n\n1. **Legal & Regulatory Scan** — Global AI-generated adult content laws: age verification, consent, privacy, IP, jurisdiction-by-jurisdiction compliance\n2. **Age Verification Architecture** — Multi-layer identity verification, strict access gating behind verified premium subscriptions\n3. **Explicit Consent Protocol** — Opt-in flows, safe word / de-escalation mechanisms, full user control\n4. **BlaQOut After Dark Sub-Brand** — Distinct branding separate from main BlaQOut Studio SFW identity\n\n### PHASE 2 — Interactive AI (Concurrent)\n\n1. **NSFW-Optimized LLM Research** — Identify open-source or API-driven models (Llama/Mistral variants, specialized services) with fewer content restrictions. Balance quality, cost, legal compliance\n2. **Persona Intimacy Context Module** — Manage context, memory, empathy, persona consistency for adult conversational experiences within MAVIS\n3. **UI/UX Design** — Persona selection, thematic prompts, roleplay options, consent controls\n\n### PHASE 3 — Generated Media (Post Phase 1)\n\n1. **Adult Image Generation** — Open-source Stable Diffusion variants fine-tuned for adult content, deployed locally (GPU) or via specialized API\n2. **Prompt Engineering Pipeline** — Translate user requests into optimized model inputs\n3. **Video Generation R&D** — Long-term research into temporal consistency, realistic motion for adult video AI\n\n---\n\n### CONCLUSION\nMAVIS orchestrates the workflows. The gap is specialized, less-restricted generative models. Phase 1 legal foundation is non-negotiable before any monetized rollout.',
  ARRAY['blaqout', 'strategy', 'shard', 'expansion', 'business', 'digital-content', 'phase-plan'],
  ARRAY['BLAQOUT_SHARD', 'BlaQOut Expansion Strategy'],
  '{"shard": true, "version": "1.0", "priority": "critical", "skip_sr": true}'::jsonb,
  v_now,
  v_now
);

-- ─────────────────────────────────────────────────────────
-- QUEST 1 — Legal Scan (Phase 1, Critical)
-- ─────────────────────────────────────────────────────────
INSERT INTO public.quests (
  user_id, title, description, type, status, difficulty,
  xp_reward, codex_points_reward, progress_current, progress_target,
  category, real_world_mapping, created_at, updated_at
) VALUES (
  v_uid,
  'Legal Scan: AI-Generated Adult Content Laws (Global)',
  E'Execute a comprehensive legal research scan covering global regulatory frameworks for AI-generated adult content.\n\nScope:\n• Age verification laws (US COPPA, EU DSA, UK Online Safety Act, AU eSafety)\n• Consent requirements for AI-generated likeness and content\n• Content restrictions by jurisdiction (US, EU, UK, AU, CA as primary markets)\n• Privacy laws intersecting with adult content platforms (GDPR, CCPA)\n• Intellectual property implications of AI-generated adult content\n• Platform liability exposure and safe harbor considerations\n• Payment processor policies (Stripe, PayPal, adult-friendly alternatives)\n\nDeliverable: Concise actionable compliance report with risk matrix per jurisdiction. Identify which markets to launch in first based on regulatory clarity.\n\nOutput feeds: Age verification architecture, consent protocol design, platform ToS.',
  'epic',
  'active',
  'Hard',
  500,
  250,
  0,
  1,
  'BlaQOut Studio',
  'Research global legal compliance requirements before any adult content platform launch',
  v_now,
  v_now
);

-- ─────────────────────────────────────────────────────────
-- QUEST 2 — Age Verification Architecture
-- ─────────────────────────────────────────────────────────
INSERT INTO public.quests (
  user_id, title, description, type, status, difficulty,
  xp_reward, codex_points_reward, progress_current, progress_target,
  category, real_world_mapping, created_at, updated_at
) VALUES (
  v_uid,
  'Design: Age Verification & Access Gating System',
  E'Research and design a robust, multi-layer age verification architecture for BlaQOut Studio adult content access.\n\nResearch:\n• Third-party identity verification services (Veriff, Onfido, Yoti, AgeID)\n• Document-based vs. credit card vs. ID token approaches\n• Privacy-preserving verification (zero-knowledge proofs for age)\n• Cost per verification at scale\n\nArchitecture Design:\n• Verification gate before premium subscription access\n• How verification state persists across sessions\n• Re-verification triggers (account suspicious activity, etc.)\n• Integration points with payment processor and subscription system\n\nDeliverable: Recommended verification vendor shortlist (top 3 with pros/cons) + architectural diagram for access control flow.',
  'side',
  'active',
  'Hard',
  300,
  150,
  0,
  1,
  'BlaQOut Studio',
  'Design age gate architecture — required before any adult content is accessible on platform',
  v_now,
  v_now
);

-- ─────────────────────────────────────────────────────────
-- QUEST 3 — Consent Protocol Design
-- ─────────────────────────────────────────────────────────
INSERT INTO public.quests (
  user_id, title, description, type, status, difficulty,
  xp_reward, codex_points_reward, progress_current, progress_target,
  category, real_world_mapping, created_at, updated_at
) VALUES (
  v_uid,
  'Design: Explicit Consent Protocol & User Control System',
  E'Design the consent architecture that governs all adult content interactions on the platform.\n\nUser Consent Flows:\n• Explicit opt-in for adult content at account level\n• Per-session confirmation for escalated content tiers\n• Granular content preference controls (what types, intensity levels)\n• Persistent preferences stored per user\n\nSafety Controls:\n• Safe word / immediate de-escalation mechanism in AI conversations\n• One-click "cool down" mode — returns interaction to SFW without losing context\n• Content reporting and feedback system\n• Block / limit persona behaviors per user preference\n\nData & Privacy:\n• What consent data is stored, for how long, under what policy\n• User ability to withdraw consent and purge data\n• Audit trail for compliance demonstration\n\nDeliverable: User flow diagrams + technical specification document.',
  'side',
  'active',
  'Hard',
  300,
  150,
  0,
  1,
  'BlaQOut Studio',
  'Design consent and safety UX — legally required and ethically essential before launch',
  v_now,
  v_now
);

-- ─────────────────────────────────────────────────────────
-- QUEST 4 — BlaQOut After Dark Branding
-- ─────────────────────────────────────────────────────────
INSERT INTO public.quests (
  user_id, title, description, type, status, difficulty,
  xp_reward, codex_points_reward, progress_current, progress_target,
  category, real_world_mapping, created_at, updated_at
) VALUES (
  v_uid,
  'Brand: BlaQOut After Dark — Sub-Brand Identity',
  E'Develop the "BlaQOut After Dark" sub-brand that houses adult offerings while protecting the main BlaQOut Studio SFW reputation.\n\nBrand Strategy:\n• Define the tonal distinction between BlaQOut Studio (SFW, creative, professional) and BlaQOut After Dark (adult, premium, exclusive)\n• Naming — confirm "After Dark" vs. alternatives (BlaQOut Noir, BlaQOut Unfiltered, etc.)\n• Relationship model — same company, clearly separated brand experience\n\nVisual Identity:\n• Colour palette (distinct from main brand but clearly in the same family)\n• Typography choices\n• Logo mark concept\n• UI mood board for the adult platform UI\n\nContent & Voice:\n• Tone of voice guidelines for After Dark personas vs. main brand\n• Marketing language that is explicit about adult nature without being gratuitous\n\nDeliverable: Brand brief + initial concept assets.',
  'side',
  'active',
  'Normal',
  200,
  100,
  0,
  1,
  'BlaQOut Studio',
  'Create distinct adult sub-brand identity — protects main brand while establishing premium adult presence',
  v_now,
  v_now
);

-- ─────────────────────────────────────────────────────────
-- QUEST 5 — Alternative LLM Research
-- ─────────────────────────────────────────────────────────
INSERT INTO public.quests (
  user_id, title, description, type, status, difficulty,
  xp_reward, codex_points_reward, progress_current, progress_target,
  category, real_world_mapping, created_at, updated_at
) VALUES (
  v_uid,
  'Research: Open-Source & API LLMs with Fewer Content Restrictions',
  E'Research and identify LLMs suitable for adult conversational content that can be integrated alongside MAVIS.\n\nResearch Targets:\n• Open-source models: Llama 3 variants, Mistral variants, Mixtral — self-hostable, no content filters\n• Specialized API services that explicitly support adult content (identify current providers, pricing, reliability)\n• Fine-tuning pathways — what would it cost to fine-tune an existing open model on adult conversational data\n• Quality comparison vs. Claude/GPT for conversational depth and persona consistency\n\nEvaluation Criteria:\n• Content restriction level\n• Response quality for persona roleplay\n• API reliability / self-hosting requirements\n• Cost per token at expected scale\n• Legal/ToS compliance for commercial use\n\nHosting Options:\n• RunPod, Vast.ai, Lambda Labs for GPU self-hosting\n• Replicate, Together.ai, Anyscale for managed inference\n• Cost modelling at 1k, 10k, 100k monthly active users\n\nDeliverable: Comparison matrix of top 5 candidates with recommendation + integration pathway for MAVIS.',
  'main',
  'active',
  'Hard',
  400,
  200,
  0,
  1,
  'BlaQOut Studio',
  'Identify which AI models can power adult conversational experiences at scale and cost',
  v_now,
  v_now
);

-- ─────────────────────────────────────────────────────────
-- QUEST 6 — Platform Monetization Architecture
-- ─────────────────────────────────────────────────────────
INSERT INTO public.quests (
  user_id, title, description, type, status, difficulty,
  xp_reward, codex_points_reward, progress_current, progress_target,
  category, real_world_mapping, created_at, updated_at
) VALUES (
  v_uid,
  'Design: BlaQOut After Dark — Revenue & Subscription Architecture',
  E'Design the full monetization stack for the adult content platform.\n\nSubscription Tiers:\n• Tier structure (e.g. free / After Dark Basic / After Dark Premium / VIP)\n• What each tier unlocks (SFW personas, adult chat, image gen, video, custom personas)\n• Pricing research — benchmark against OF, DreamGF, Replika Premium, Candy.ai\n\nPayment Infrastructure:\n• Adult-friendly payment processors: Epoch, CCBill, SegPay, Paxum — research fees, reliability, chargeback rates\n• Crypto payment option (privacy-conscious users)\n• Stripe workarounds / separate merchant account strategy\n\nCreator Revenue Sharing (future):\n• If platform opens to third-party persona creators — rev share model\n• IP protection for custom persona designs\n\nRevenue Projections:\n• Conservative / base / aggressive scenario models at 6, 12, 24 months\n• CAC targets and LTV estimates based on comparable platforms\n\nDeliverable: Monetization brief + payment processor shortlist + 3-scenario revenue projection.',
  'side',
  'active',
  'Hard',
  350,
  175,
  0,
  1,
  'BlaQOut Studio',
  'Define how the adult platform makes money and what payment infrastructure it needs',
  v_now,
  v_now
);

RAISE NOTICE 'BlaQOut Studio shard seeded: 1 knowledge note + 6 quests created.';
END $$;
