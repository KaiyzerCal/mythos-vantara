// src/mavis/agentTypes.ts
// Unified AgentEntity type system.
// Council Members (inward deliberation, full access) and Personas
// (outward sovereign agents, scoped access) extend this base.

export type AgentType = "council" | "persona";
export type DataAccessTier = "full" | "scoped" | "public";

// ─── BASE AGENT ENTITY ────────────────────────────────────
export interface AgentEntity {
  id: string;
  userId: string;
  agentType: AgentType;
  name: string;
  role?: string;
  description?: string;
  avatarUrl?: string;
  voiceStyle?: string;
  personalityPrompt?: string;
  telegramEnabled: boolean;
  dataAccessTier: DataAccessTier;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// ─── COUNCIL MEMBER ───────────────────────────────────────
// Private. Inward-facing. Full data access. Inner deliberation.
export interface UnifiedCouncilMember extends AgentEntity {
  agentType: "council";
  archetype?: string;
  specialty?: string;
  characterClass?: string;
  notes?: string;
  karma?: number;
  heartbeatEnabled?: boolean;
  canBeSummoned: boolean;
  dataAccessTier: "full";
}

// ─── PERSONA ──────────────────────────────────────────────
// Public-facing. Outward sovereign agents. AI influencer trajectory.
export interface UnifiedPersona extends AgentEntity {
  agentType: "persona";
  archetype?: string;
  systemPrompt?: string;
  contentNiche?: string;
  model?: string;
  canJoinCouncil: boolean;
  dataAccessTier: "scoped" | "public";
}

// ─── DATA ACCESS SCOPES ───────────────────────────────────
export const DATA_ACCESS_SCOPES: Record<DataAccessTier, string[]> = {
  full: [
    "profile","quests","tasks","skills","rankings",
    "transformations","journalEntries","vaultEntries",
    "councilMembers","inventory","storeItems","energySystems",
    "bpmSessions","allies","rituals","pendingApprovals","personas",
  ],
  scoped: [
    "profile","quests","skills","rankings",
    "transformations","inventory","allies","rituals",
  ],
  public: ["profile","skills","rankings"],
};

// ─── COUNCIL BOARD MESSAGE ────────────────────────────────
export interface CouncilBoardMessage {
  id: string;
  speakerId: string;
  speakerName: string;
  speakerRole: string;
  speakerType?: AgentType | "mavis" | "user";
  content: string;
  timestamp: number;
  isUser: boolean;
  summoned?: boolean;
}

// ─── TELEGRAM CONFIG ──────────────────────────────────────
export interface AgentTelegramConfig {
  agentId: string;
  agentType: AgentType;
  botToken?: string;
  chatId?: string;
  webhookUrl?: string;
  active: boolean;
}

// ─── CONTENT ──────────────────────────────────────────────
export type ContentType = "post"|"thread"|"article"|"script"|"pitch"|"email"|"caption";
export type ContentStatus = "draft"|"published"|"archived";

export interface PersonaContent {
  id?: string;
  personaId: string;
  title: string;
  body: string;
  contentType: ContentType;
  platform?: string;
  status: ContentStatus;
  engagementScore?: number;
  revenueGenerated?: number;
  publishedAt?: string;
}
