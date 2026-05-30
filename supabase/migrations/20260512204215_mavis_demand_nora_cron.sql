-- ═══════════════════════════════════════════════════════════
-- DEMAND SCAN + NORA CRON JOBS
-- Weekly demand detection and daily Nora content scheduling.
-- Requires: pg_cron + pg_net + vault secrets (supabase_url, service_role_key)
-- ═══════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- WEEKLY DEMAND SCAN — Saturday 6:00 AM UTC
-- Scans trending pain points via Grok, proposes 3-5 products.
-- Results appear in Inbox Task Log as requires_confirmation.
-- ─────────────────────────────────────────────────────────────
select cron.schedule(
  'mavis-demand-scan',
  '0 6 * * 6',
  $$
  insert into mavis_tasks (user_id, type, description, status)
  select distinct user_id,
         'demand_scan',
         'Weekly demand scan — ' || to_char(now(), 'YYYY-MM-DD'),
         'pending'
  from   mavis_memory
  where  created_at > now() - interval '30 days'
  on conflict do nothing;
  $$
);

-- ─────────────────────────────────────────────────────────────
-- NORA WEEKLY CONTENT — Wednesday 10:00 AM UTC
-- Queues a nora_tweet task for a value-driven post mid-week.
-- MAVIS generates content based on recent operator activity.
-- ─────────────────────────────────────────────────────────────
select cron.schedule(
  'mavis-nora-weekly-content',
  '0 10 * * 3',
  $$
  insert into mavis_tasks (user_id, type, description, payload, status)
  select distinct user_id,
         'nora_tweet',
         'Weekly Nora content post — ' || to_char(now(), 'YYYY-MM-DD'),
         jsonb_build_object(
           'content', 'MAVIS_GENERATE',
           'context', 'Generate a value-driven tweet in Nora Vale''s voice about revenue systems, AI automation, or building leverage. Make it specific and actionable. Under 240 chars.'
         ),
         'requires_confirmation'
  from   mavis_memory
  where  created_at > now() - interval '30 days'
  on conflict do nothing;
  $$
);

-- ─────────────────────────────────────────────────────────────
-- REVENUE SNAPSHOT — every Monday 9:00 AM UTC
-- Logs a point-in-time revenue summary to mavis_tasks result.
-- ─────────────────────────────────────────────────────────────
select cron.schedule(
  'mavis-revenue-snapshot',
  '0 9 * * 1',
  $$
  insert into mavis_tasks (user_id, type, description, status)
  select distinct user_id,
         'revenue_snapshot',
         'Weekly revenue snapshot — ' || to_char(now(), 'YYYY-MM-DD'),
         'pending'
  from   mavis_memory
  where  created_at > now() - interval '30 days'
  on conflict do nothing;
  $$
);
