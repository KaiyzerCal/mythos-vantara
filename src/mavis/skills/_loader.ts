// Import all skills to trigger self-registration via registerSkill()
// Add new skills here as they are created

import { loadRuntimeSkills, clearRuntimeSkills } from "./_registry";

/** Call on session start to load DB-backed runtime skills for this user */
export async function initSkills(userId: string): Promise<void> {
  clearRuntimeSkills();
  await loadRuntimeSkills(userId);
}

import "./daily-brief/index";
import "./quest-review/index";
import "./energy-check/index";
import "./revenue-report/index";
import "./knowledge-extract/index";
import "./habit-check/index";
import "./finance-brief/index";
import "./reflection-prompt/index";
import "./agent-status/index";
import "./comprehensive-review/index";
import "./enterprise-search/index";
import "./outreach-prep/index";
import "./content-brief/index";
import "./design-generate/index";
import "./competitive-intelligence/index";
import "./meeting-brief/index";
import "./social-content/index";
import "./market-research/index";
import "./stock-research/index";
import "./email-draft/index";
import "./goal-review/index";
import "./weekly-retro/index";
import "./lead-gen/index";
import "./image-gen/index";
import "./opportunity-scan/index";
import "./health-protocol/index";
import "./code-review/index";
import "./news-brief/index";
import "./data-analysis/index";
import "./doc-gen/index";
import "./pdf-qa/index";
import "./debate/index";
import "./resume-screen/index";
import "./proposal-gen/index";
import "./github-triage/index";
import "./capability-manifest/index";
import "./crypto-intel/index";
import "./company-research/index";
import "./web-scrape/index";
import "./youtube-intel/index";
import "./influencer-research/index";
import "./poster-gen/index";
import "./music-gen/index";
import "./logo-gen/index";

// ── Communication & Messaging ──────────────────────────────────────────────────
import "./telegram-send/index";
import "./sms-send/index";
import "./phone-call/index";
import "./slack-send/index";
import "./discord-send/index";

// ── Social Media ───────────────────────────────────────────────────────────────
import "./linkedin-post/index";
import "./twitter-post/index";
import "./instagram-post/index";
import "./tiktok-post/index";

// ── Productivity & Files ───────────────────────────────────────────────────────
import "./calendar-manage/index";
import "./email-triage/index";
import "./notion-sync/index";
import "./gdrive-sync/index";
import "./sheets-agent/index";
import "./airtable-agent/index";
import "./google-tasks/index";
import "./planner/index";
import "./morning-brief/index";

// ── Research & Learning ────────────────────────────────────────────────────────
import "./deep-research/index";
import "./arxiv/index";
import "./flashcard-gen/index";
import "./translate/index";
import "./browser-agent/index";

// ── Media & Creative ───────────────────────────────────────────────────────────
import "./video-gen/index";
import "./video-narrator/index";
import "./podcast-gen/index";
import "./comic-gen/index";
import "./heygen-video/index";
import "./transcribe/index";

// ── Health & Fitness ───────────────────────────────────────────────────────────
import "./sleep-coach/index";
import "./spotify-control/index";
import "./whoop-stats/index";
import "./oura-stats/index";
import "./strava-activity/index";

// ── Business & Commerce ────────────────────────────────────────────────────────
import "./shopify-agent/index";
import "./gumroad/index";
import "./expense-track/index";
import "./crm-lookup/index";
import "./seo-audit/index";
import "./competitor-track/index";
import "./brand-identity/index";
import "./product-creator/index";

// ── Developer & System Tools ───────────────────────────────────────────────────
import "./deploy-check/index";
import "./self-improve/index";
import "./letta-memory/index";
import "./meeting-transcribe/index";

// ── Personal Intelligence ──────────────────────────────────────────────────────
import "./weather/index";
import "./maps/index";
import "./pattern-insights/index";
import "./self-reflect/index";

// ── VANTARA App-Native ─────────────────────────────────────────────────────────
import "./goal-engine/index";
import "./daily-notes/index";
import "./vault-save/index";
import "./achievement-check/index";
import "./brain-consolidate/index";
import "./data-export/index";

// ── Advanced Research & Intelligence ──────────────────────────────────────────
import "./exa-search/index";
import "./firecrawl/index";
import "./council-session/index";
import "./vision-agent/index";
import "./causal-engine/index";
import "./demand-scan/index";

// ── Marketing & Growth ─────────────────────────────────────────────────────────
import "./social-scheduler/index";
import "./campaign-runner/index";
import "./beehiiv-agent/index";
import "./calendly-agent/index";

// ── Creation & Learning ────────────────────────────────────────────────────────
import "./narrative-engine/index";
import "./design-system/index";
import "./spaced-repetition/index";
import "./web-builder/index";
import "./computer-use/index";
import "./booking/index";

// ── Research & Intelligence ────────────────────────────────────────────────────
import "./hn-digest/index";
import "./reddit/index";
import "./rss-monitor/index";
import "./instagram-trends/index";
import "./market-radar/index";
import "./sec-filings/index";
import "./world-monitor/index";
import "./website-qa/index";
import "./media-analyst/index";
import "./entity-graph/index";
import "./knowledge-base/index";
import "./context-scout/index";
import "./readwise/index";
import "./ingest-url/index";
import "./youtube-ingest/index";

// ── Productivity & Workflow ────────────────────────────────────────────────────
import "./meeting-notes/index";
import "./meeting-prep/index";
import "./cron-setup/index";
import "./workflow-run/index";
import "./periodic-review/index";
import "./outcome-tracker/index";
import "./gmail-sync/index";
import "./gcontacts-sync/index";
import "./google-workspace/index";
import "./obsidian-export/index";
import "./reclaim-ai/index";
import "./linear-agent/index";
import "./goal-judge/index";
import "./learning-engine/index";
import "./auto-journal/index";

// ── Business & Developer ───────────────────────────────────────────────────────
import "./netlify-deploy/index";
import "./vercel-deploy/index";
import "./terminal/index";
import "./python-run/index";
import "./code-deploy/index";
import "./salesforce/index";
import "./bank-connect/index";
import "./strategy-council/index";
import "./sentry/index";
import "./so-curator/index";
import "./e2b-sandbox/index";
import "./critic-agent/index";
import "./form-submit/index";
import "./gmb-agent/index";
import "./prompt-vault/index";

// ── Creative & Media ───────────────────────────────────────────────────────────
import "./video-edit/index";
import "./video-download/index";
import "./tts/index";
import "./voicebox/index";
import "./transcribe-memo/index";
import "./repurpose-content/index";
import "./pdf-gen/index";
import "./widget-gen/index";
import "./wordpress/index";
import "./blotato/index";

// ── Health & Life ──────────────────────────────────────────────────────────────
import "./wearable-data/index";
import "./health-monitor/index";
import "./performance-science/index";
import "./polymarket/index";
import "./predict/index";

// ── AI & Memory ────────────────────────────────────────────────────────────────
import "./ai-tutor/index";
import "./mem0/index";
import "./autonomous-task/index";
import "./emotion-analysis/index";
import "./emotion-tag/index";
import "./screenpipe/index";

// ── Agent Architecture & Orchestration ────────────────────────────────────────
import "./world-model/index";
import "./goal-decompose/index";
import "./goal-loop/index";
import "./plans/index";
import "./crew-orchestrate/index";
import "./director/index";
import "./agent-builder/index";
import "./mini-agent/index";

// ── Code & LLM Infrastructure ─────────────────────────────────────────────────
import "./code-exec/index";
import "./code-delegate/index";
import "./llm-router/index";
import "./multi-provider/index";
import "./chain-builder/index";
import "./openai-finetune/index";
import "./finetune-export/index";

// ── Persona & Social Agents ───────────────────────────────────────────────────
import "./persona-forge/index";
import "./persona-router/index";
import "./flowise/index";
import "./discourse-runner/index";
import "./persona-social/index";
import "./personaplex/index";
import "./nora-discord/index";
import "./nora-engage/index";

// ── Memory & Self-Evolution ───────────────────────────────────────────────────
import "./signal-watch/index";
import "./relationship-intel/index";
import "./memory-consolidate/index";
import "./memory-agent/index";
import "./user-model/index";
import "./profile-update/index";
import "./compound-learn/index";
import "./reflection-agent/index";
import "./capability-audit/index";
import "./archivist/index";
import "./tacit-prune/index";
import "./self-evolve/index";

// ── Video & Media Production ──────────────────────────────────────────────────
import "./article-extract/index";
import "./avatar-video/index";
import "./higgsfield-video/index";
import "./story-gen/index";
import "./shortform-ingest/index";
import "./video-render/index";
import "./heygen-simple/index";
import "./notebook-embed/index";

// ── Publishing & Distribution ─────────────────────────────────────────────────
import "./site-editor/index";
import "./social-publish/index";
import "./instagram-manage/index";

// ── Notifications & Proactive Intelligence ────────────────────────────────────
import "./push-notify/index";
import "./proactive-brief/index";
import "./proactive-nudge/index";
import "./streak-alert/index";
import "./quest-nudge/index";
import "./quest-calendar/index";
import "./announce/index";

// ── Scheduling & Sync ──────────────────────────────────────────────────────────
import "./calendar-sync/index";
import "./standing-orders/index";
import "./notion-sync-raw/index";
import "./notes-import/index";
import "./github-sync/index";

// ── Evaluation & Quality ──────────────────────────────────────────────────────
import "./quality-eval/index";
import "./agent-eval/index";
import "./security-scan/index";

// ── System & Voice ─────────────────────────────────────────────────────────────
import "./run-doctor/index";
import "./live-voice/index";
import "./realtime-v2/index";
import "./voice-session/index";
import "./skill-catalog-browse/index";

// ── Media & Entertainment ──────────────────────────────────────────────────────
import "./youtube-agent/index";
import "./spotify-agent/index";
import "./spotify-sync/index";

// ── Web Intelligence ───────────────────────────────────────────────────────────
import "./web-crawl/index";
import "./web-scrape-deep/index";
import "./cloud-browser/index";

// ── Hardware & IoT ────────────────────────────────────────────────────────────
import "./galaxy-ring/index";

// ── AI Receptionist ───────────────────────────────────────────────────────────
import "./receptionist-config/index";
import "./receptionist-provision/index";

// ── NAVI Agent ────────────────────────────────────────────────────────────────
import "./navi-finetune-check/index";
import "./navi-finetune/index";
import "./navi-heartbeat/index";
import "./navi-memory/index";

// ── Prymal Brand ──────────────────────────────────────────────────────────────
import "./prymal-approve/index";
import "./prymal-brand/index";
import "./prymal-google/index";
import "./prymal-intel/index";
import "./prymal-onboard/index";

// ── Apify Actor Skills ─────────────────────────────────────────────────────────
import "./backlink-build/index";
import "./email-finder/index";
import "./social-email-scrape/index";
import "./job-search-agent/index";
import "./newsletter-gen-actor/index";
import "./insider-trading/index";
import "./earnings-predict/index";
import "./economics-calendar/index";
import "./coinmarketcap-data/index";
import "./funding-intel/index";
import "./cot-report/index";
import "./reddit-user/index";
import "./audio-transcribe-actor/index";
import "./content-processor/index";
import "./global-markets/index";

// ── MCP Server Skills via Apify ───────────────────────────────────────────────
import "./hubspot-crm/index";
import "./home-assistant/index";
import "./slidespeak/index";
import "./mindmap-gen/index";
import "./invoice-collect/index";
import "./explorium-intel/index";
import "./zendesk-agent/index";
import "./figma-export/index";
import "./ga4-report/index";
import "./gsc-report/index";
import "./whatsapp-cloud/index";
import "./financial-datasets-mcp/index";

// ── Prompt-Only Skills via mavis-chat ─────────────────────────────────────────
import "./content-machine/index";
import "./deep-focus/index";
import "./summarise/index";
import "./pipeline-run/index";
import "./hire-specialist/index";
import "./bioneer-protocol/index";

// ── Messaging ─────────────────────────────────────────────────────────────────
import "./whatsapp-send/index";
