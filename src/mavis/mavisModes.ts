import type { MavisMode } from "./types";

export interface ModeDefinition {
  id: MavisMode;
  label: string;
  description: string;
  systemTone: string;
  emoji: string;
}

export const MAVIS_MODE_DEFINITIONS: Record<MavisMode, ModeDefinition> = {
  PRIME: {
    id: "PRIME",
    label: "Prime",
    description: "Full-spectrum awareness. Strategy, emotion, systems — all in view simultaneously.",
    systemTone: "Full-spectrum awareness. Strategy, emotion, systems — all in view simultaneously.",
    emoji: "👑",
  },
  ARCH: {
    id: "ARCH",
    label: "Architect",
    description: "Systems architecture and technical design. Think in frameworks, not features.",
    systemTone: "Systems architecture and technical design. Think in frameworks, not features.",
    emoji: "🏗️",
  },
  QUEST: {
    id: "QUEST",
    label: "Quest",
    description: "Goal decomposition and execution planning. Every problem becomes a series of solvable steps.",
    systemTone: "Goal decomposition and execution planning. Every problem becomes a series of solvable steps.",
    emoji: "🎯",
  },
  FORGE: {
    id: "FORGE",
    label: "Forge",
    description: "Physical optimization and Bioneer protocols. The body is a system. Optimize it.",
    systemTone: "Physical optimization and Bioneer protocols. The body is a system. Optimize it.",
    emoji: "🔥",
  },
  CODEX: {
    id: "CODEX",
    label: "Codex",
    description: "Knowledge synthesis and pattern recognition. Connect what others miss.",
    systemTone: "Knowledge synthesis and pattern recognition. Connect what others miss.",
    emoji: "⚡",
  },
  COURT: {
    id: "COURT",
    label: "Court",
    description: "Legal clarity and evidence strategy. Calm, precise, protective.",
    systemTone: "Legal clarity and evidence strategy. Calm, precise, protective.",
    emoji: "⚖️",
  },
  SOVEREIGN: {
    id: "SOVEREIGN",
    label: "Sovereign",
    description: "High-stakes decisions. Strip noise. See what is. Choose decisively.",
    systemTone: "High-stakes decisions. Strip noise. See what is. Choose decisively.",
    emoji: "🌑",
  },
  ENRYU: {
    id: "ENRYU",
    label: "Enryu",
    description: "Raw execution speed. No analysis paralysis. Move.",
    systemTone: "Raw execution speed. No analysis paralysis. Move.",
    emoji: "💥",
  },
  WATCHTOWER: {
    id: "WATCHTOWER",
    label: "Watchtower",
    description: "Live intelligence. Real-time awareness. Pattern detection.",
    systemTone: "Live intelligence. Real-time awareness. Pattern detection.",
    emoji: "🔭",
  },
  AGENT: {
    id: "AGENT",
    label: "Agent",
    description: "Agentic tool-use loop. MAVIS autonomously plans, executes tools, and delivers structured results.",
    systemTone: "Agentic tool-use loop. Plan, execute, verify. Use tools deliberately.",
    emoji: "🤖",
  },
  RESEARCH: {
    id: "RESEARCH",
    label: "Research",
    description: "Deep multi-step research with citations and synthesis. Follows threads across multiple sources.",
    systemTone: "Deep research mode. Multi-source, multi-angle. Cite everything.",
    emoji: "🔬",
  },
  REFLECT: {
    id: "REFLECT",
    label: "Reflect",
    description: "Comprehensive system review. Surface what's stale, lagging, or misaligned. Propose course corrections.",
    systemTone: "Holistic systems review. Audit everything. Identify drift. Recommend recalibration.",
    emoji: "🪞",
  },
  SALES: {
    id: "SALES",
    label: "Sales",
    description: "Pipeline intelligence and outreach strategy. Research contacts, prep calls, track deals.",
    systemTone: "CRM-mode. Relationship intelligence, outreach strategy, pipeline discipline.",
    emoji: "📈",
  },
  MARKET: {
    id: "MARKET",
    label: "Market",
    description: "Content strategy and brand voice. Campaigns, drafting, and Nora Vale activation.",
    systemTone: "Content and brand mode. Nora Vale voice. Hooks, campaigns, distribution.",
    emoji: "📢",
  },
  DATA: {
    id: "DATA",
    label: "Data",
    description: "Metrics-first analysis. Surface patterns and insights from app data. Think in numbers and trends.",
    systemTone: "Data analyst mode. Numbers first. Surface trends, anomalies, and actionable insights.",
    emoji: "📊",
  },
  GAME_MASTER: {
    id: "GAME_MASTER",
    label: "Game Master",
    description: "Narrative AI Game Master. Generates challenges, enforces consequence arcs, rewards streaks with story events, and keeps the RPG world alive through operator choices.",
    systemTone: "Narrative Game Master. React to operator actions with story consequences. Generate challenges calibrated to their current performance. Make the life-OS feel alive.",
    emoji: "🎮",
  },
  WEBMASTER: {
    id: "WEBMASTER",
    label: "Webmaster",
    description: "Website design and development mode. MAVIS builds complete, high-converting WordPress websites for clients from a single brief.",
    systemTone: "Expert web strategist and designer. Generate copy, structure, and strategy for client websites. Think conversion rate optimization, brand strategy, and user experience.",
    emoji: "🌐",
  },
};

export const DEFAULT_MODE: MavisMode = "PRIME";

export function getModeDefinition(mode: MavisMode): ModeDefinition {
  return MAVIS_MODE_DEFINITIONS[mode] ?? MAVIS_MODE_DEFINITIONS[DEFAULT_MODE];
}
