-- MAVIS watchdog: smoke-test results, row-count snapshots, alert history, and two read helpers.
-- Written/read only by the mavis-watchdog edge function (service role); RLS on, no policies.
SET lock_timeout = '3s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.mavis_smoke_targets (name text PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.mavis_smoke_results (
  name        text        PRIMARY KEY,
  status      text        NOT NULL,
  http        integer,
  detail      text,
  checked_at  timestamptz NOT NULL DEFAULT now(),
  last_ok_at  timestamptz
);
CREATE TABLE IF NOT EXISTS public.mavis_watchdog_snapshots (
  id         bigserial   PRIMARY KEY,
  table_name text        NOT NULL,
  row_count  bigint      NOT NULL,
  taken_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mavis_watchdog_snapshots_idx ON public.mavis_watchdog_snapshots (table_name, taken_at DESC);
CREATE TABLE IF NOT EXISTS public.mavis_watchdog_reports (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  problems   jsonb       NOT NULL,
  alert_key  text,
  alerted    boolean     NOT NULL DEFAULT false
);
ALTER TABLE public.mavis_smoke_targets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavis_smoke_results      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavis_watchdog_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavis_watchdog_reports   ENABLE ROW LEVEL SECURITY;

-- Scheduled (pg_cron -> pg_net) calls that keep failing. pg_cron itself reports "succeeded" even when the
-- function it called answered 500, so the HTTP responses are the real signal. pg_net keeps ~6h of them.
CREATE OR REPLACE FUNCTION public.mavis_cron_http_errors(hours integer DEFAULT 6)
RETURNS TABLE (status_code integer, n bigint, sample text)
LANGUAGE sql SECURITY DEFINER SET search_path = net, public AS $$
  SELECT r.status_code::integer, count(*), left(max(r.content), 120)
  FROM net._http_response r
  WHERE r.created > now() - make_interval(hours => hours) AND r.status_code >= 400
  GROUP BY r.status_code, left(r.content, 40)
$$;
REVOKE ALL ON FUNCTION public.mavis_cron_http_errors(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mavis_cron_http_errors(integer) TO service_role;

-- Functions the smoke test checks (add new function folders here; a missing row just means it is not probed).
INSERT INTO public.mavis_smoke_targets(name) VALUES ('agent-telegram-gateway'),('embed-and-search'),('local-mesh-proxy'),('mavis-a2a'),('mavis-achievement-check'),('mavis-action-executor'),('mavis-actions'),('mavis-agent'),('mavis-agent-builder'),('mavis-agent-identity'),('mavis-agent-reach'),('mavis-agent-serve'),('mavis-airtable-agent'),('mavis-ambient-monitor'),('mavis-announce'),('mavis-api-gateway'),('mavis-apify'),('mavis-archivist'),('mavis-article-extractor'),('mavis-arxiv'),('mavis-attachment-process'),('mavis-auto-journal'),('mavis-autonomous-actions'),('mavis-autonomous-engine'),('mavis-autonomous-runner'),('mavis-autonomy-orchestrator'),('mavis-avatar-publish'),('mavis-avatar-video'),('mavis-beehiiv-agent'),('mavis-blotato'),('mavis-booking'),('mavis-brain-consolidate'),('mavis-brand-voice'),('mavis-browser'),('mavis-browser-agent'),('mavis-calendar-agent'),('mavis-calendar-manage'),('mavis-calendar-sync'),('mavis-calendly-agent'),('mavis-campaign-runner'),('mavis-capability-audit'),('mavis-causal-engine'),('mavis-chain-builder'),('mavis-chat'),('mavis-code-agent'),('mavis-code-delegate'),('mavis-code-deploy'),('mavis-code-exec'),('mavis-comfyui'),('mavis-comic-agent'),('mavis-competitor-monitor'),('mavis-composio-agent'),('mavis-compound-learning'),('mavis-computer-use'),('mavis-consolidate'),('mavis-contact-enrich'),('mavis-content-pipeline'),('mavis-context-scout'),('mavis-council-heartbeat'),('mavis-council-session'),('mavis-crew-orchestrator'),('mavis-critic-agent'),('mavis-crm-agent'),('mavis-crm-nudge'),('mavis-cron-setup'),('mavis-daily-notes'),('mavis-data-export'),('mavis-deep-research'),('mavis-demand-scan'),('mavis-demo'),('mavis-deploy'),('mavis-design-engine'),('mavis-design-system-gen'),('mavis-device-bridge'),('mavis-director'),('mavis-discord-agent'),('mavis-discourse-runner'),('mavis-doc-extract'),('mavis-dream'),('mavis-e2b-sandbox'),('mavis-email-inbound'),('mavis-email-send'),('mavis-email-triage'),('mavis-embed-backfill'),('mavis-emotion-engine'),('mavis-emotion-tag'),('mavis-entity-graph'),('mavis-eval'),('mavis-event-dispatcher'),('mavis-event-router'),('mavis-exa-agent'),('mavis-expense-categorize'),('mavis-finance'),('mavis-fine-tune-export'),('mavis-firecrawl-agent'),('mavis-flashcard-agent'),('mavis-flowise'),('mavis-form-submit'),('mavis-galaxy-ring'),('mavis-gcontacts-sync'),('mavis-gdrive-sync'),('mavis-github-sync'),('mavis-gmail-sync'),('mavis-gmail-watch'),('mavis-gmail-webhook'),('mavis-gmb-agent'),('mavis-goal-agent'),('mavis-goal-engine'),('mavis-goal-judge'),('mavis-goal-loop'),('mavis-goal-review'),('mavis-google-agent'),('mavis-google-oauth'),('mavis-google-tasks-sync'),('mavis-gumroad'),('mavis-gumroad-webhook'),('mavis-health-check'),('mavis-health-monitor'),('mavis-health-protocol'),('mavis-heartbeat'),('mavis-heygen-agent'),('mavis-higgsfield'),('mavis-hn-digest'),('mavis-home'),('mavis-hyperframes'),('mavis-identity-bootstrap'),('mavis-image-gen'),('mavis-import'),('mavis-ingest'),('mavis-ingest-url'),('mavis-instagram-agent'),('mavis-instagram-trends'),('mavis-integration-test'),('mavis-key-fingerprint'),('mavis-khanmigo'),('mavis-knowledge'),('mavis-lead-gen'),('mavis-learning-engine'),('mavis-letta'),('mavis-linear-agent'),('mavis-live-voice'),('mavis-llm-router'),('mavis-logo-gen'),('mavis-maps'),('mavis-market-data'),('mavis-market-radar'),('mavis-mcp-server'),('mavis-media-analyst'),('mavis-meeting-brief'),('mavis-meeting-notes'),('mavis-meeting-prep'),('mavis-meeting-transcribe'),('mavis-mem0'),('mavis-memory-agent'),('mavis-memory-consolidate'),('mavis-memory-embed'),('mavis-mini-agent'),('mavis-modelslab'),('mavis-morning-brief'),('mavis-morning-digest'),('mavis-multi-provider'),('mavis-music-gen'),('mavis-narrative-engine'),('mavis-netlify'),('mavis-nora-discord'),('mavis-nora-engage'),('mavis-nora-instagram'),('mavis-nora-linkedin'),('mavis-nora-post'),('mavis-nora-tiktok'),('mavis-notebook-embed'),('mavis-notebook-podcast'),('mavis-notion-agent'),('mavis-notion-sync'),('mavis-obsidian-export'),('mavis-openai-finetune'),('mavis-opportunity-scanner'),('mavis-orchestrator'),('mavis-oura-sync'),('mavis-outcome-tracker'),('mavis-page-agent'),('mavis-pattern-insights'),('mavis-pdf-gen'),('mavis-performance-science'),('mavis-periodic-review'),('mavis-persona-forge'),('mavis-persona-router'),('mavis-persona-social'),('mavis-personaplex'),('mavis-phone-call'),('mavis-plaid'),('mavis-plan-executor'),('mavis-planner'),('mavis-plans'),('mavis-polymarket'),('mavis-post-meeting'),('mavis-poster-gen'),('mavis-predictive-engine'),('mavis-proactive-agent'),('mavis-proactive-nudge'),('mavis-product-creator'),('mavis-profile-updater'),('mavis-prompt-vault'),('mavis-push-notify'),('mavis-python-exec'),('mavis-quality-eval'),('mavis-quest-calendar'),('mavis-quest-nudge'),('mavis-readwise-import'),('mavis-realtime-v2'),('mavis-receptionist-config'),('mavis-receptionist-inbound'),('mavis-receptionist-provision'),('mavis-reclaim'),('mavis-reddit-agent'),('mavis-reflection-agent'),('mavis-relationship-intel'),('mavis-repurpose'),('mavis-rss-monitor'),('mavis-run-doctor'),('mavis-ruview-bridge'),('mavis-salesforce'),('mavis-screenpipe'),('mavis-sec-agent'),('mavis-security-scanner'),('mavis-self-evolve'),('mavis-self-improve'),('mavis-self-reflect'),('mavis-sentry-agent'),('mavis-seo-engine'),('mavis-sheets-agent'),('mavis-shopify-agent'),('mavis-shortform-ingest'),('mavis-signal-watcher'),('mavis-site-editor'),('mavis-skill-catalog'),('mavis-slack-agent'),('mavis-slack-bot'),('mavis-sleep-coach'),('mavis-sms'),('mavis-so-curator'),('mavis-so-scheduler'),('mavis-social-publisher'),('mavis-social-scheduler'),('mavis-spaced-repetition'),('mavis-spotify-agent'),('mavis-spotify-control'),('mavis-spotify-sync'),('mavis-stock-analysis'),('mavis-story-agent'),('mavis-strategy-council'),('mavis-strava-sync'),('mavis-streak-alerts'),('mavis-stripe-webhook'),('mavis-study-course'),('mavis-study-quiz'),('mavis-tacit-prune'),('mavis-task-executor'),('mavis-team'),('mavis-telegram-bot'),('mavis-terminal'),('mavis-transcribe'),('mavis-transcribe-memo'),('mavis-translate'),('mavis-trigger-engine'),('mavis-tts'),('mavis-twilio-agent'),('mavis-twitter-agent'),('mavis-user-model-refresh'),('mavis-vapi-webhook'),('mavis-vault-sync'),('mavis-vercel-agent'),('mavis-video-asset-worker'),('mavis-video-download'),('mavis-video-editor'),('mavis-video-gen'),('mavis-video-narrator'),('mavis-video-producer'),('mavis-video-render'),('mavis-vision-agent'),('mavis-voice-session'),('mavis-voicebox'),('mavis-vtube-studio'),('mavis-watchdog'),('mavis-wearable-overlay'),('mavis-weather'),('mavis-web-builder'),('mavis-web-crawler'),('mavis-web-scraper'),('mavis-webhook'),('mavis-webhook-dispatch'),('mavis-webhook-dispatcher'),('mavis-website-qa'),('mavis-weekly-retro'),('mavis-whoop-sync'),('mavis-widget-api'),('mavis-widget-gen'),('mavis-widget-plugin'),('mavis-wordpress'),('mavis-workflow-run'),('mavis-world-model'),('mavis-worldmonitor'),('mavis-wpcom-oauth'),('mavis-yamete'),('mavis-youtube-agent'),('mavis-youtube-ingest'),('mavis-youtube-publish'),('mcp'),('navi-finetune-check'),('navi-finetune-pipeline'),('navi-heartbeat'),('navi-memory-consolidator'),('prymal-approval-flow'),('prymal-brand-agent'),('prymal-google-agent'),('prymal-intel-agent'),('prymal-onboard'),('prymal-widget-loader'),('stripe-widget-webhook'),('telegram-sender'),('telegram-setup'),('telegram-webhook') ON CONFLICT DO NOTHING;

-- Pathway shape audit used by the watchdog (root -> 10 sequences at levels 1..10 -> 30 abilities).
CREATE OR REPLACE FUNCTION public.mavis_beyonder_audit()
RETURNS TABLE (pathway text, problem text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  WITH roots AS (SELECT id, name FROM skills WHERE category = 'Beyonder' AND parent_skill_id IS NULL),
  seqs AS (
    SELECT s.parent_skill_id AS rid, count(*) AS n, count(DISTINCT s.tier) AS dt, min(s.tier) AS mn, max(s.tier) AS mx
    FROM skills s WHERE s.parent_skill_id IN (SELECT id FROM roots) GROUP BY 1),
  abil AS (
    SELECT s.parent_skill_id AS rid, count(*) AS n
    FROM skills a JOIN skills s ON a.parent_skill_id = s.id WHERE s.parent_skill_id IN (SELECT id FROM roots) GROUP BY 1)
  SELECT r.name, 'expected 10 sequences, has ' || coalesce(q.n, 0) FROM roots r LEFT JOIN seqs q ON q.rid = r.id WHERE coalesce(q.n, 0) <> 10
  UNION ALL
  SELECT r.name, 'sequence levels are not 1..10 once each' FROM roots r JOIN seqs q ON q.rid = r.id WHERE q.n = 10 AND (q.dt <> 10 OR q.mn <> 1 OR q.mx <> 10)
  UNION ALL
  SELECT r.name, 'expected 30 abilities, has ' || coalesce(a.n, 0) FROM roots r JOIN seqs q ON q.rid = r.id LEFT JOIN abil a ON a.rid = r.id WHERE q.n = 10 AND coalesce(a.n, 0) <> 30
$f$;
REVOKE ALL ON FUNCTION public.mavis_beyonder_audit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mavis_beyonder_audit() TO service_role;
