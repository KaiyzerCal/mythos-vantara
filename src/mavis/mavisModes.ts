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
};

export const DEFAULT_MODE: MavisMode = "PRIME";

export function getModeDefinition(mode: MavisMode): ModeDefinition {
  return MAVIS_MODE_DEFINITIONS[mode] ?? MAVIS_MODE_DEFINITIONS[DEFAULT_MODE];
}
