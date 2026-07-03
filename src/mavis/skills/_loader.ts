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
