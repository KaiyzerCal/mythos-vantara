export type MavisMode =
  | "PRIME"
  | "ARCH"
  | "QUEST"
  | "FORGE"
  | "CODEX"
  | "COURT"
  | "SOVEREIGN"
  | "ENRYU"
  | "WATCHTOWER"
  | "AGENT"
  | "RESEARCH"
  | "REFLECT"
  | "SALES"
  | "MARKET"
  | "DATA"
  | "GAME_MASTER"
  | "WEBMASTER";

export interface MavisMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  actions?: ParsedAction[];
}

export interface ParsedAction {
  type: string;
  payload: Record<string, unknown>;
  raw: string;
}

export interface ParseResult {
  cleanText: string;
  actions: ParsedAction[];
}

export type ActionClassification = "AUTO" | "CONFIRM";

export interface ExecutionResult {
  status: "success" | "pending_confirmation" | "error";
  action: ParsedAction;
  message?: string;
}

export interface AppStateSnapshot {
  quests?: unknown[];
  tasks?: unknown[];
  skills?: unknown[];
  journal?: unknown[];
  vault?: unknown[];
  council?: unknown[];
  inventory?: unknown[];
  energy?: unknown;
  allies?: unknown[];
  transformations?: unknown[];
  rankings?: unknown[];
  profile?: Record<string, unknown>;
}
