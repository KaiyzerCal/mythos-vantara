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
