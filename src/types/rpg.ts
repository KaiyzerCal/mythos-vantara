// ============================================================
// VANTARA.EXE — RPG Types
// Migrated from Rork GameState → Lovable/Supabase-compatible
// ============================================================

export type Rank = "F" | "E" | "D" | "C" | "B" | "A" | "S" | "SS" | "SSS" | "Sovereign";

export type QuestType = "main" | "side" | "daily" | "epic";
export type QuestStatus = "active" | "completed" | "failed" | "locked";
export type QuestDifficulty = "Easy" | "Normal" | "Hard" | "Extreme" | "Impossible";

export type EnergySystem =
  | "Ki" | "Aura" | "Nen" | "Nen/Aura" | "Haki" | "Magoi" | "Chakra"
  | "Cursed Energy" | "Mana" | "VRIL" | "Ichor" | "VRIL/Ichor"
  | "Lacrima" | "Black Heart" | "Aether" | "Emerald Flames";

export type EnergyStatus = "mastered" | "advanced" | "developing" | "perfect";

export type TransformationTier =
  | "Spartan" | "Saiyan" | "Thorn" | "Karma"
  | "Regalia" | "Ouroboros" | "BlackHeart" | "FinalAscent";

export type CouncilClass = "core" | "advisory" | "think-tank" | "shadows";

export type ItemRarity = "common" | "rare" | "epic" | "legendary" | "mythic";
export type ItemType = "consumable" | "equipment" | "material" | "artifact";
export type ItemCategory = "consumable" | "material" | "upgrade" | "artifact";

export interface PlayerIdentity {
  inscribedName: string;
  trueName?: string;
  titles: string[];
  speciesLineage: string[];
  aura?: string;
  territory: {
    towerFloorsInfluence: string;
    class: string;
  };
}

export interface PlayerStats {
  level: number;
  xp: number;
  xpToNextLevel: number;
  rank: Rank;
  STR: number;
  AGI: number;
  VIT: number;
  INT: number;
  WIS: number;
  CHA: number;
  LCK: number;
  auraPower: string;
  fatigue: number;
  fullCowlSync: number;
  codexIntegrity: number;
}

export interface Buff {
  label: string;
  value: number;
  unit: string;
}

export interface Ability {
  title: string;
  irl: string;
}

export interface TransformationData {
  id: string;
  tier: TransformationTier;
  name: string;
  order: number;
  bpmRange: string;
  category?: string;
  description?: string;
  energy: string;
  jjkGrade: string;
  opTier: string;
  activeBuffs: Buff[];
  passiveBuffs: Buff[];
  abilities: Ability[];
  unlocked: boolean;
}

export interface EnergyLevel {
  type: EnergySystem;
  current: number;
  max: number;
  color: string;
  description: string;
  status?: EnergyStatus;
}

export interface Quest {
  id: string;
  title: string;
  description: string;
  type: QuestType;
  status: QuestStatus;
  xpReward: number;
  codexPointsReward?: number;
  lootRewards?: {
    itemName: string;
    quantity: number;
    rarity?: ItemRarity;
  }[];
  linkedSkillIds?: string[];
  progress?: { current: number; target: number };
  realWorldMapping?: string;
  category?: string;
  difficulty?: QuestDifficulty;
  deadline?: string;
  createdAt?: number;
}

export interface CouncilMember {
  id: string;
  name: string;
  role: string;
  specialty?: string;
  class: CouncilClass;
  notes: string;
  avatar?: string;
}

export interface BPMSession {
  id: string;
  timestamp: number;
  bpm: number;
  form: string;
  duration: number;
  mood?: string;
  notes?: string;
}

export interface SkillTreeNode {
  id: string;
  name: string;
  description: string;
  tier: number;
  unlocked: boolean;
  cost: number;
  energyType: EnergySystem;
  category: string;
  prerequisites?: string[];
  proficiency?: number;
}

export interface DailyRitual {
  id: string;
  name: string;
  description: string;
  type: "legal" | "business" | "self_care" | "fitness" | "other";
  category?: string;
  xpReward: number;
  completed: boolean;
  streak: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  description: string;
  type: ItemType;
  rarity: ItemRarity;
  quantity: number;
  effect?: string;
  slot?: string;
  tier?: string;
  effects?: { label: string; value: number; unit: string }[];
}

export interface Currency {
  name: string;
  amount: number;
  icon: string;
}

export interface AllyData {
  id: string;
  name: string;
  relationship: "ally" | "harem" | "council" | "rival";
  level: number;
  specialty: string;
  affinity: number;
  avatar?: string;
}

export interface RosterEntry {
  id: string;
  display: string;
  role: "ally" | "enemy" | "npc" | "self";
  rank: string;
  level: number;
  jjkGrade: string;
  opTier: string;
  gpr: number;
  pvp: number;
  influence: string;
  notes: string;
}

export interface JournalEntry {
  id: string;
  timestamp: number;
  title: string;
  content: string;
  mood?: string;
  tags: string[];
  xpGained?: number;
  category?: string;
  importance?: "low" | "medium" | "high" | "critical";
}

export interface VaultEntry {
  id: string;
  timestamp: number;
  title: string;
  content: string;
  category: "legal" | "business" | "personal" | "evidence" | "achievement";
  importance: "low" | "medium" | "high" | "critical";
  attachments?: string[];
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  type: "task" | "habit";
  status: "active" | "completed" | "archived";
  recurrence: "once" | "daily" | "weekly" | "monthly";
  xpReward: number;
  linkedSkillId?: string;
  streak?: number;
  completedCount: number;
  lastCompleted?: number;
  createdAt: number;
}

export interface StoreItem {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  rarity: ItemRarity;
  category: ItemCategory;
  effect?: string;
  requirements?: { level?: number; rank?: string };
}

export interface GameState {
  identity: PlayerIdentity;
  stats: PlayerStats;
  currentForm: string;
  currentBPM: number;
  energySystems: EnergyLevel[];
  transformations: TransformationData[];
  quests: Quest[];
  councils: CouncilMember[];
  bpmSessions: BPMSession[];
  skillTrees: SkillTreeNode[];
  skillSubTrees?: Record<string, SkillTreeNode[]>;
  skillProficiency?: Record<string, number>;
  dailyRituals: DailyRitual[];
  inventory: InventoryItem[];
  currencies: Currency[];
  allies: AllyData[];
  roster: RosterEntry[];
  journalEntries: JournalEntry[];
  vaultEntries: VaultEntry[];
  tasks: Task[];
  storeItems?: StoreItem[];
  currentFloor: number;
  gpr: number;
  pvpRating: number;
  arcStory?: string;
}

// ---- DISPLAY / UI helpers ----
export const RANK_COLORS: Record<Rank, string> = {
  F: "#666666",
  E: "#8B8B00",
  D: "#008B8B",
  C: "#0000CD",
  B: "#228B22",
  A: "#FF8C00",
  S: "#DC143C",
  SS: "#9400D3",
  SSS: "#FF4500",
  Sovereign: "#FFD700",
};

export const getRankForLevel = (level: number): Rank => {
  if (level >= 100) return "Sovereign";
  if (level >= 90) return "SSS";
  if (level >= 80) return "SS";
  if (level >= 70) return "S";
  if (level >= 60) return "A";
  if (level >= 50) return "B";
  if (level >= 40) return "C";
  if (level >= 30) return "D";
  if (level >= 20) return "E";
  return "F";
};

export const calculateXPForLevel = (level: number): number =>
  Math.floor(200 * Math.pow(level, 1.45));
