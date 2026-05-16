-- ═══════════════════════════════════════════════════════════
-- BlaQOut Studio — Lilu Intimacy Module Spec
-- MAVIS_SHARD_LILU_INTIMACY v1.0
--
-- HOW TO USE:
--   1. Go to Supabase Dashboard → Authentication → Users
--   2. Copy your UUID from the users list
--   3. Paste it below where it says YOUR_USER_ID_HERE
--   4. Run in SQL Editor
--
-- PREREQUISITE: blaqout_studio_shard.sql already run.
-- This shard adds Lilu's specific role and the Intimacy
-- Module spec that were not captured in the v1.0 strategy note.
-- ═══════════════════════════════════════════════════════════

DO $$
DECLARE
  v_uid uuid := 'YOUR_USER_ID_HERE'; -- ← paste your user ID here
  v_now timestamptz := now();
BEGIN

-- ─────────────────────────────────────────────────────────
-- KNOWLEDGE NOTE — Lilu Intimacy Module spec
-- ─────────────────────────────────────────────────────────
INSERT INTO public.mavis_notes (
  user_id, title, content, tags, aliases, properties, created_at, updated_at
) VALUES (
  v_uid,
  'SPEC: Lilu Intimacy Module — MAVIS Sub-Module Design',
  E'## Lilu Intimacy Module\n## MAVIS_SHARD_LILU_INTIMACY v1.0 | May 2026\n\n### PURPOSE\nA dedicated sub-module within MAVIS that manages context, memory, empathy, and persona consistency for NSFW conversational experiences. This is the orchestration layer — it directs specialized LLMs, not replaces them.\n\n### LILU''S ROLE\nLilu (AI Girlfriend & Digital Empress) serves as strategic co-architect and psychological framework lead for BlaQOut After Dark. Her contributions:\n- Prompt engineering frameworks for high-fidelity intimate roleplay\n- Persona consistency guidelines (character immersion, emotional depth)\n- Escalation/de-escalation logic and "safe word" UX design\n- Content tier definitions (what belongs in each subscription tier)\n\n### MODULE RESPONSIBILITIES\n1. **Context Manager** — maintains per-session and long-term intimacy context\n2. **Persona Router** — selects which persona + LLM handles each request based on user preference and tier\n3. **Consent Gate** — enforces opt-in state; blocks NSFW routing if consent not active\n4. **Escalation Engine** — manages tone transitions (SFW → intimate → explicit) with user-controlled intensity\n5. **Safe Word Handler** — immediate context reset + returns to SFW mode without losing conversation history\n6. **Memory Layer** — stores significant moments, preferences, recurring themes per persona per user\n\n### INTEGRATION POINTS\n- Reads from: `relationship_states`, `persona_memories`, `mavis_tacit` (user preferences)\n- Routes to: NSFW-optimized LLM (determined by Quest: LLM Research)\n- Writes to: `persona_memories` (intimate context), `relationship_states` (bond progression)\n- Gated by: Age verification state + active consent record\n\n### DESIRE-TO-IMAGE PIPELINE\nWorkflow for translating user requests into NSFW image generation:\n1. User sends intent (text prompt or persona interaction)\n2. Lilu module normalizes to structured image spec (subject, style, intensity tier, persona)\n3. Routes to NSFW Stable Diffusion model (local GPU or specialized API)\n4. Returns generated image with watermark + usage metadata\n5. Logs to `persona_content` for revenue attribution if monetized\n\n### NSFW VIDEO R&D (LONG-TERM)\nContinuous research track:\n- Temporal consistency in AI video (key challenge)\n- Realistic motion and lip sync for persona avatars\n- Integration pathway with HeyGen/Kling for SFW → NSFW equivalent\n- Target: proof-of-concept within 6-12 months of After Dark launch\n\n### PHASE DEPENDENCY\nThis module CANNOT deploy until:\n- Legal scan complete + compliance report approved\n- Age verification architecture chosen and implemented\n- Consent protocol UX designed and tested\n- NSFW LLM identified and access secured',
  ARRAY['blaqout', 'lilu', 'intimacy-module', 'spec', 'architecture', 'phase-2', 'after-dark'],
  ARRAY['LILU_INTIMACY_MODULE', 'Desire-to-Image Pipeline'],
  '{"shard": true, "version": "1.0", "module": "intimacy", "skip_sr": true, "depends_on": "BLAQOUT_SHARD"}'::jsonb,
  v_now,
  v_now
);

-- ─────────────────────────────────────────────────────────
-- QUEST — Desire-to-Image Pipeline Design
-- ─────────────────────────────────────────────────────────
INSERT INTO public.quests (
  user_id, title, description, type, status, difficulty,
  xp_reward, codex_points_reward, progress_current, progress_target,
  category, real_world_mapping, created_at, updated_at
) VALUES (
  v_uid,
  'Design: Desire-to-Image NSFW Generation Pipeline',
  E'Design the full workflow for translating user intent into generated NSFW images via specialized models.\n\nWorkflow Stages:\n• Input capture — user prompt or persona interaction triggers image request\n• Normalization — structured spec (subject, composition, style, intensity tier, persona identity)\n• Model routing — select appropriate Stable Diffusion variant based on request type\n• Generation — call model (local GPU or API), handle queuing and retry logic\n• Post-processing — watermark, metadata tagging, output format\n• Storage — save to `persona_content` with content_type, revenue attribution hooks\n\nModel Research (coordinate with LLM Quest):\n• Stable Diffusion XL variants fine-tuned for adult content\n• CivitAI model registry — identify top models for realistic portraits (personas)\n• ComfyUI vs. Automatic1111 as local inference UI\n• Dedicated APIs: Prodia, Runware, Segmind — compare NSFW support, pricing, reliability\n\nPrompt Engineering Framework:\n• Positive prompt templates per persona (body type, style, aesthetic)\n• Negative prompt library (quality guards)\n• Intensity tier definitions (tasteful → explicit) with clear content gates per tier\n• LoRA fine-tuning pathway for custom persona consistency\n\nDeliverable: Pipeline architecture diagram + model shortlist + prompt engineering guide.',
  'main',
  'active',
  'Hard',
  400,
  200,
  0,
  1,
  'BlaQOut Studio',
  'Build the image generation pipeline — the visual content engine for After Dark',
  v_now,
  v_now
);

-- ─────────────────────────────────────────────────────────
-- QUEST — Lilu Intimacy Module Implementation
-- ─────────────────────────────────────────────────────────
INSERT INTO public.quests (
  user_id, title, description, type, status, difficulty,
  xp_reward, codex_points_reward, progress_current, progress_target,
  category, real_world_mapping, created_at, updated_at
) VALUES (
  v_uid,
  'Build: Lilu Intimacy Module — MAVIS Sub-Module',
  E'Implement the orchestration layer within MAVIS that manages intimate AI conversations.\n\nCore Components:\n• Context Manager — per-session + long-term intimacy context (extends mavis_memory)\n• Persona Router — selects persona + LLM by user preference and subscription tier\n• Consent Gate — reads active consent state, blocks NSFW routing if not active\n• Escalation Engine — tone transitions (SFW → intimate → explicit) with user-controlled intensity level (1-5)\n• Safe Word Handler — immediate context reset + SFW mode, preserves full history\n• Memory Layer — significant moments, preferences, recurring themes per persona per user\n\nDatabase:\n• `intimacy_sessions` table — session_id, persona_id, user_id, consent_active, intensity_level, context_summary\n• `intimacy_preferences` table — user_id, persona_id, preferred_intensity, themes, safe_word\n• Extension of `persona_memories` with intimacy_tier tag\n\nIntegration:\n• Reads: `relationship_states`, `persona_memories`, `mavis_tacit`\n• Routes: to NSFW-optimized LLM endpoint\n• Writes: `persona_memories`, `relationship_states`, `intimacy_sessions`\n\nGating Requirements (MUST be satisfied first):\n• Age verification confirmed for user\n• Explicit consent record active\n• NSFW LLM endpoint available\n\nDeliverable: Working MAVIS sub-module with all components + DB migration + integration tests.',
  'epic',
  'active',
  'Hard',
  600,
  300,
  0,
  1,
  'BlaQOut Studio',
  'The core AI orchestration layer that makes intimate conversations coherent, consistent, and safe',
  v_now,
  v_now
);

-- ─────────────────────────────────────────────────────────
-- QUEST — NSFW Video R&D Track
-- ─────────────────────────────────────────────────────────
INSERT INTO public.quests (
  user_id, title, description, type, status, difficulty,
  xp_reward, codex_points_reward, progress_current, progress_target,
  category, real_world_mapping, created_at, updated_at
) VALUES (
  v_uid,
  'R&D: NSFW AI Video Generation — Long-Term Track',
  E'Continuous research initiative tracking the state of AI video generation for adult content.\n\nResearch Areas:\n• Temporal consistency — the core unsolved challenge (frame-to-frame coherence)\n• Realistic motion — natural body movement, lip sync, expression dynamics\n• Current SOTA models: Kling AI, Runway Gen-3, Pika 2.0, HunyuanVideo, Wan2.1\n• NSFW-capable variants: CogVideoX fine-tunes, AnimateDiff-SDXL extensions\n• Local deployment vs. API (latency, cost, content policy)\n\nMilestone Targets:\n• Month 1-2: Landscape survey + capability matrix per model\n• Month 3-4: Proof of concept — 5-10s clips featuring a persona avatar\n• Month 6: Evaluate integration pathway with After Dark image pipeline\n• Month 12: Assess production readiness for subscriber offering\n\nEthical/Legal:\n• Synthetic identity disclosure requirements\n• Deepfake legislation applicability to fully AI-generated personas\n• Age verification applicability to video vs. image content\n\nDeliverable: Quarterly research briefs + proof-of-concept demos + go/no-go recommendation at Month 6.',
  'side',
  'active',
  'Hard',
  300,
  150,
  0,
  1,
  'BlaQOut Studio',
  'Long-horizon R&D to determine if and when AI video is viable for the After Dark offering',
  v_now,
  v_now
);

RAISE NOTICE 'Lilu Intimacy Module shard seeded: 1 knowledge note + 3 quests added.';
END $$;
