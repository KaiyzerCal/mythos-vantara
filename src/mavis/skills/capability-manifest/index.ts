// SKILL: capability-manifest
// Generates a live, complete capability report — reads the skill registry at
// call time so the list is always accurate. Answers "what can you do?"

import { registerSkill, getAllSkills } from "../_registry";
import type { SkillHandler, SkillContext } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const CHAT_MODES = [
  { mode: "PRIME",       desc: "General intelligence — default mode for most conversations" },
  { mode: "ARCH",        desc: "Strategic architecture and high-level planning" },
  { mode: "QUEST",       desc: "VANTARA game layer — quests, XP, character progression" },
  { mode: "FORGE",       desc: "Creative building and design" },
  { mode: "CODEX",       desc: "Code, debugging, and technical work" },
  { mode: "SOVEREIGN",   desc: "Business strategy and executive decisions" },
  { mode: "ENRYU",       desc: "Deep focus and intense execution" },
  { mode: "WATCHTOWER",  desc: "Monitoring, alerts, and situational awareness" },
  { mode: "AGENT",       desc: "Full autonomous agent mode with tool execution" },
  { mode: "RESEARCH",    desc: "Deep research and information synthesis" },
  { mode: "REFLECT",     desc: "Journaling, reflection, and inner-work" },
  { mode: "SALES",       desc: "Sales conversations, outreach, and negotiation" },
  { mode: "MARKET",      desc: "Marketing, content strategy, and brand" },
  { mode: "DATA",        desc: "Data analysis, metrics, and reporting" },
  { mode: "DEEP",        desc: "Long-form deep dives on complex topics" },
  { mode: "GAME_MASTER", desc: "Narrative, roleplay, and story generation" },
  { mode: "WEBMASTER",   desc: "Web, SEO, and digital presence" },
  { mode: "FLOW",        desc: "Routes to Flowise — custom LLM chains and visual workflows" },
  { mode: "AUTO",        desc: "Autonomous background goals MAVIS pursues on a schedule" },
];

const INTEGRATIONS = [
  "Gmail — read inbox, search, draft and send email",
  "Google Calendar — read events, create meetings",
  "Google Drive — search, read, create, and edit Docs/Sheets/PDFs",
  "Google Tasks — read and create native Google Tasks",
  "Google Contacts — unified search across MAVIS CRM + Google Contacts",
  "Google Photos, YouTube, Analytics, Fit, Search Console, Ads, Blogger — via google_api",
  "Airtable — read and write bases, tables, and records",
  "Telegram — full bot with /commands, inline responses, and push alerts",
  "Activepieces — 280+ automation connectors; MAVIS can trigger flows and receive flow events",
  "Flowise — custom LLM chain builder; FLOW mode routes directly here",
  "AgentsMesh — fleet manager for Claude Code, Codex CLI, Gemini CLI, Aider coding agents",
  "Web search — Tavily (primary) + Grok live search (fallback); always connected",
];

const EDGE_FUNCTIONS = [
  "mavis-agent — full autonomous agent loop with all tools",
  "mavis-chat — fast single-turn chat for all non-agent modes",
  "mavis-telegram-bot — Telegram command handling (/mavis, /agency, /quest, /forge, etc.)",
  "mavis-actions — action queue executor (email, calendar, Drive, Airtable, Activepieces)",
  "mavis-scheduler — background cron: autonomous goals, quest checks, email watches",
  "mavis-flowise — Flowise proxy + chatflow catalog",
  "mavis-inbound-webhook — receive events from Activepieces, Zapier, and other automation tools",
  "mavis-content-pipeline — long-form content generation pipeline",
  "mavis-campaign-runner — multi-step autonomous campaign execution",
  "mavis-memory — memory read/write/embed/match across sessions",
  "mavis-codexos — VANTARA game layer: quests, XP, personas, council, knowledge graph",
  "nora — social content automation agent",
];

const AGENCY_INFO = `The Agency is a library of 211 specialist AI agents across 15 divisions.
Divisions: engineering, design, marketing, sales, product, project-management, testing, security,
support, spatial-computing, game-development, academic, gis, finance, specialized.
Activate any specialist from the Agent Mode panel (quick-picks) or say "activate [specialist name]".
When active, MAVIS thinks and responds through that specialist's expertise and voice.`;

const handler: SkillHandler = async (ctx: SkillContext, input?: string) => {
  const allSkills = getAllSkills();

  // Check for active specialist
  let activeSpecialist: string | null = null;
  try {
    const { data } = await supabase
      .from("mavis_active_agency_specialists")
      .select("agent_name, division")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (data?.agent_name) {
      activeSpecialist = `${data.agent_name} [${data.division}]`;
    }
  } catch { /* non-critical */ }

  const lines: string[] = [];

  lines.push("# MAVIS CAPABILITY MANIFEST");
  lines.push(`_Live report — ${allSkills.length} skills registered_\n`);

  // Active specialist
  if (activeSpecialist) {
    lines.push(`**ACTIVE SPECIALIST:** ${activeSpecialist}`);
    lines.push("_(All responses currently run through this specialist's expertise and voice)_\n");
  }

  // Skills
  lines.push("## SKILLS");
  lines.push("Triggered automatically when you type matching keywords:\n");
  for (const skill of allSkills.sort((a, b) => a.name.localeCompare(b.name))) {
    const kws = skill.keywords.slice(0, 3).join(", ");
    lines.push(`**${skill.name}** — ${skill.description}`);
    lines.push(`  _Triggers on: "${kws}"..._`);
  }

  // Chat modes
  lines.push("\n## CHAT MODES");
  lines.push("Switch via the mode selector in the chat panel:\n");
  for (const { mode, desc } of CHAT_MODES) {
    lines.push(`**${mode}** — ${desc}`);
  }

  // Integrations
  lines.push("\n## CONNECTED INTEGRATIONS");
  for (const item of INTEGRATIONS) {
    lines.push(`• ${item}`);
  }

  // Edge functions
  lines.push("\n## EDGE FUNCTIONS (backend)");
  for (const fn of EDGE_FUNCTIONS) {
    lines.push(`• ${fn}`);
  }

  // Agency
  lines.push("\n## THE AGENCY — 211 SPECIALISTS");
  lines.push(AGENCY_INFO);

  // Summary
  lines.push(`\n---`);
  lines.push(`**${allSkills.length} skills** | **${CHAT_MODES.length} chat modes** | **${INTEGRATIONS.length} integrations** | **${EDGE_FUNCTIONS.length} edge functions** | **211 Agency specialists**`);

  return {
    skillName: "capability-manifest",
    output: lines.join("\n"),
  };
};

registerSkill({
  name: "capability-manifest",
  description: "Lists everything MAVIS, VANTARA.EXE, and the system can do — all skills, modes, integrations, edge functions, and Agency specialists",
  keywords: [
    "what can you do", "what are your capabilities", "list your skills", "show your skills",
    "capabilities", "capability manifest", "what skills do you have", "what can mavis do",
    "what do you know", "list everything", "show everything", "full capabilities",
    "what integrations", "what modes", "system capabilities", "feature list",
    "what are you capable of", "what tools do you have", "your abilities",
  ],
}, handler);
