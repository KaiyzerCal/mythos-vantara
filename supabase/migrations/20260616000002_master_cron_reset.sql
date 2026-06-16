-- ============================================================
-- MAVIS — MASTER CRON RESET
-- Unschedules all existing jobs and re-registers them cleanly.
-- Safe to run multiple times (idempotent).
-- Paste into Supabase SQL editor and run.
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Unschedule all existing MAVIS cron jobs ──────────────────
-- Wrapped in individual DO blocks so one missing job doesn't abort the rest.
DO $$ BEGIN PERFORM cron.unschedule('mavis-task-executor');           EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-so-scheduler');            EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-memory-embed');            EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-ambient-monitor');         EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-action-processor');        EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-autonomous-runner');       EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-meeting-prep-check');      EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-heartbeat');               EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-social-scheduler');        EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-morning-brief');           EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-spaced-repetition');       EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-predictive-engine');       EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-market-radar-daily');      EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-opportunity-scanner');     EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-performance-science-daily'); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-streak-alerts');           EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-quest-nudge-morning');     EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-quest-nudge-evening');     EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-outcome-tracker-daily');   EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-entity-graph');            EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-nightly-consolidation');   EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-consolidate');             EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-daily-notes');             EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-daily-brief-seed');        EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-goal-review-seed');        EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-self-reflect');            EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-periodic-review');         EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-world-model');             EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-narrative-engine');        EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-self-evolve-weekly');      EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-compound-learning-weekly'); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-self-improve-weekly');     EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-causal-engine-weekly');    EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-relationship-intel');      EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-pattern-insights');        EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-weekly-retro');            EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-tacit-prune');             EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-idle-quest-scan');         EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-demand-scan');             EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-nora-weekly-content');     EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('mavis-revenue-snapshot');        EXCEPTION WHEN others THEN NULL; END $$;

-- ============================================================
-- HIGH FREQUENCY — every 2–30 minutes
-- ============================================================

-- Core agentic worker: picks up and executes all pending mavis_tasks
SELECT cron.schedule(
  'mavis-task-executor',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-task-executor',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Standing order scheduler: checks active templates and queues due ones
SELECT cron.schedule(
  'mavis-so-scheduler',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-so-scheduler',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Embedding queue: processes notes waiting to be embedded into the knowledge graph
SELECT cron.schedule(
  'mavis-memory-embed',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-memory-embed',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Ambient monitor: watches for overdue quests, dormant contacts, health anomalies, etc.
SELECT cron.schedule(
  'mavis-ambient-monitor',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-ambient-monitor',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Autonomous action queue processor
SELECT cron.schedule(
  'mavis-action-processor',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-autonomous-actions',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Autonomous goal runner (long-horizon background goals)
SELECT cron.schedule(
  'mavis-autonomous-runner',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-autonomous-runner',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Meeting prep: checks for upcoming calendar events in the next 2h
SELECT cron.schedule(
  'mavis-meeting-prep-check',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-meeting-prep',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Integration heartbeat: syncs Gmail, Calendar, Strava, Oura, WHOOP, GitHub, Readwise, etc.
SELECT cron.schedule(
  'mavis-heartbeat',
  '*/20 * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-heartbeat',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- ============================================================
-- HOURLY
-- ============================================================

-- Social content scheduler: dispatches queued Nora posts
SELECT cron.schedule(
  'mavis-social-scheduler',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-social-scheduler',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- ============================================================
-- DAILY — direct function calls
-- ============================================================

-- Morning brief (6am): generate daily intelligence summary
SELECT cron.schedule(
  'mavis-morning-brief',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-morning-brief',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Spaced repetition (5:30am): surface due review items
SELECT cron.schedule(
  'mavis-spaced-repetition',
  '30 5 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-spaced-repetition',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Predictive engine (6am): update forecasts and predictions
SELECT cron.schedule(
  'mavis-predictive-engine',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-predictive-engine',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Market radar (6:30am): scan for market signals and competitor moves
SELECT cron.schedule(
  'mavis-market-radar-daily',
  '30 6 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-market-radar',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Opportunity scanner (7am): detect monetizable signals from data
SELECT cron.schedule(
  'mavis-opportunity-scanner',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-opportunity-scanner',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Performance science (7:05am): score daily output and patterns
SELECT cron.schedule(
  'mavis-performance-science-daily',
  '5 7 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-performance-science',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Streak alerts (8am): flag broken or at-risk streaks
SELECT cron.schedule(
  'mavis-streak-alerts',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-streak-alerts',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Quest nudge morning (8am): surface stalled quests
SELECT cron.schedule(
  'mavis-quest-nudge-morning',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-quest-nudge',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{"time":"morning"}'::jsonb
  );
  $$
);

-- Daily notes (10pm): archive the day's notes to the codex
SELECT cron.schedule(
  'mavis-daily-notes',
  '0 22 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-daily-notes',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Quest nudge evening (6pm): end-of-day progress check
SELECT cron.schedule(
  'mavis-quest-nudge-evening',
  '0 18 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-quest-nudge',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{"time":"evening"}'::jsonb
  );
  $$
);

-- Outcome tracker (9pm): log what was accomplished today
SELECT cron.schedule(
  'mavis-outcome-tracker-daily',
  '0 21 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-outcome-tracker',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Entity graph (3am): update relationship map from recent data
SELECT cron.schedule(
  'mavis-entity-graph',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-entity-graph',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Memory consolidation (2am): merge short-term observations into long-term knowledge
SELECT cron.schedule(
  'mavis-nightly-consolidation',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-consolidate',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- ============================================================
-- DAILY — seed tasks into mavis_tasks for the task executor
-- These INSERT rows that mavis-task-executor picks up on its next run.
-- Skips if a task already exists in the last 12 hours (idempotent).
-- ============================================================

-- Daily brief seed (7am): create a daily_brief task for every active user
SELECT cron.schedule(
  'mavis-daily-brief-seed',
  '0 7 * * *',
  $$
  INSERT INTO public.mavis_tasks (user_id, type, description, status)
  SELECT p.id, 'daily_brief', 'Daily intelligence brief', 'pending'
  FROM public.profiles p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.mavis_tasks mt
    WHERE mt.user_id = p.id
      AND mt.type = 'daily_brief'
      AND mt.created_at > now() - interval '12 hours'
      AND mt.status IN ('pending', 'running', 'approved', 'completed')
  );
  $$
);

-- Goal review seed (9pm): prompt MAVIS to review active goals each evening
SELECT cron.schedule(
  'mavis-goal-review-seed',
  '0 21 * * *',
  $$
  INSERT INTO public.mavis_tasks (user_id, type, description, status)
  SELECT p.id, 'goal', 'Evening goal review — assess active goals and surface any blockers', 'pending'
  FROM public.profiles p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.mavis_tasks mt
    WHERE mt.user_id = p.id
      AND mt.type = 'goal'
      AND mt.description LIKE 'Evening goal review%'
      AND mt.created_at > now() - interval '12 hours'
      AND mt.status IN ('pending', 'running', 'approved')
  );
  $$
);

-- ============================================================
-- WEEKLY — direct function calls
-- ============================================================

-- Self-reflect (Sunday 3:30am): system-wide audit and self-assessment
SELECT cron.schedule(
  'mavis-self-reflect',
  '30 3 * * 0',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-self-reflect',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Periodic review (Sunday 3am): review KPIs, skill progress, and arc story
SELECT cron.schedule(
  'mavis-periodic-review',
  '0 3 * * 0',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-periodic-review',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- World model (Sunday 5am): rebuild operator's world model from all recent data
SELECT cron.schedule(
  'mavis-world-model',
  '0 5 * * 0',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-world-model',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Narrative engine (Sunday 4am): synthesize arc story from recent events
SELECT cron.schedule(
  'mavis-narrative-engine',
  '0 4 * * 0',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-narrative-engine',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Self-evolve (Sunday 3am): update MAVIS's own behavioral patterns
SELECT cron.schedule(
  'mavis-self-evolve-weekly',
  '0 3 * * 0',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-self-evolve',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Compound learning (Sunday 1am): synthesize learning signals into skill improvements
SELECT cron.schedule(
  'mavis-compound-learning-weekly',
  '0 1 * * 0',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-compound-learning',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Self-improve (Sunday 1:30am): generate improvement proposals for operator review
SELECT cron.schedule(
  'mavis-self-improve-weekly',
  '30 1 * * 0',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-self-improve',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Causal engine (Sunday 2am): identify cause-effect chains in operator's data
SELECT cron.schedule(
  'mavis-causal-engine-weekly',
  '0 2 * * 0',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-causal-engine',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Relationship intel (Monday 8am): update relationship health scores
SELECT cron.schedule(
  'mavis-relationship-intel',
  '0 8 * * 1',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-relationship-intel',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Pattern insights (Monday 4am): detect behavioral patterns across all data
SELECT cron.schedule(
  'mavis-pattern-insights',
  '0 4 * * 1',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-pattern-insights',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Weekly retro (Sunday 8pm): generate weekly retrospective and Inbox summary
SELECT cron.schedule(
  'mavis-weekly-retro',
  '0 20 * * 0',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/mavis-weekly-retro',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  );
  $$
);

-- Prune stale mavis_tacit rows (Sunday 3am)
SELECT cron.schedule(
  'mavis-tacit-prune',
  '0 3 * * 0',
  $$
  DELETE FROM public.mavis_tacit
  WHERE expires_at IS NOT NULL AND expires_at < now();
  $$
);

-- ============================================================
-- WEEKLY — seed tasks into mavis_tasks
-- ============================================================

-- Idle quest scan (Sunday 9am): flag quests with 7+ days of no activity
SELECT cron.schedule(
  'mavis-idle-quest-scan',
  '0 9 * * 0',
  $$
  INSERT INTO public.mavis_tasks (user_id, type, description, status)
  SELECT p.id, 'check_idle_quests', 'Scan for quests idle 7+ days', 'pending'
  FROM public.profiles p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.mavis_tasks mt
    WHERE mt.user_id = p.id
      AND mt.type = 'check_idle_quests'
      AND mt.created_at > now() - interval '6 days'
      AND mt.status IN ('pending', 'running', 'approved', 'completed')
  );
  $$
);

-- Demand scan (Saturday 6am): scan for monetizable product demand
SELECT cron.schedule(
  'mavis-demand-scan',
  '0 6 * * 6',
  $$
  INSERT INTO public.mavis_tasks (user_id, type, description, status)
  SELECT p.id, 'demand_scan', 'Weekly demand scan — identify product opportunities', 'pending'
  FROM public.profiles p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.mavis_tasks mt
    WHERE mt.user_id = p.id
      AND mt.type = 'demand_scan'
      AND mt.created_at > now() - interval '6 days'
      AND mt.status IN ('pending', 'running', 'approved', 'completed')
  );
  $$
);

-- Revenue snapshot (Monday 9am): log weekly revenue summary
SELECT cron.schedule(
  'mavis-revenue-snapshot',
  '0 9 * * 1',
  $$
  INSERT INTO public.mavis_tasks (user_id, type, description, status)
  SELECT p.id, 'revenue_snapshot', 'Weekly revenue snapshot', 'pending'
  FROM public.profiles p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.mavis_tasks mt
    WHERE mt.user_id = p.id
      AND mt.type = 'revenue_snapshot'
      AND mt.created_at > now() - interval '6 days'
      AND mt.status IN ('pending', 'running', 'approved', 'completed')
  );
  $$
);

-- Nora weekly content (Wednesday 10am): queue Nora's weekly content batch
SELECT cron.schedule(
  'mavis-nora-weekly-content',
  '0 10 * * 3',
  $$
  INSERT INTO public.mavis_tasks (user_id, type, description, status)
  SELECT p.id, 'nora_tweet', 'Weekly Nora content batch — draft 3 tweets on business/AI/autonomy', 'requires_confirmation'
  FROM public.profiles p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.mavis_tasks mt
    WHERE mt.user_id = p.id
      AND mt.type = 'nora_tweet'
      AND mt.created_at > now() - interval '6 days'
      AND mt.status IN ('pending', 'running', 'approved', 'requires_confirmation', 'completed')
  );
  $$
);
