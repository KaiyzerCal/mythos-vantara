import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProfile, type ProfileData } from "@/hooks/useProfile";
import { useQuests, type Quest } from "@/hooks/useQuests";
import { recordAutoMemory } from "@/mavis/autoMemory";
import {
  useTasks, useJournal, useVault, useCouncils,
  useSkills, useEnergySystems, useInventory, useAllies, useBpmSessions, useActivityLog, useStoreItems, useTransformations, useRankings, useRituals, useDomainEffects,
  type Task, type JournalEntry, type VaultEntry,
  type CouncilMember, type Skill, type EnergySystem, type InventoryItem, type Ally, type BpmSession, type StoreItem, type Transformation, type RankingProfile, type Ritual, type DomainEffect,
} from "@/hooks/useDataHooks";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode?: string;
  timestamp: Date;
}

interface AppDataContextType {
  // Profile / Character
  profile: ProfileData;
  profileLoading: boolean;
  updateProfile: (updates: Partial<ProfileData>) => Promise<void>;
  awardXP: (amount: number) => Promise<void>;
  refetchProfile: () => Promise<void>;

  // Quests
  quests: Quest[];
  questsLoading: boolean;
  questStats: { total: number; active: number; completed: number; epic: number; xpEarned: number };
  createQuest: (input: any) => Promise<Quest | null>;
  updateQuest: (id: string, input: any) => Promise<void>;
  completeQuest: (id: string) => Promise<void>;
  deleteQuest: (id: string) => Promise<void>;
  refetchQuests: () => Promise<void>;

  // Rituals
  rituals: Ritual[];
  ritualsLoading: boolean;

  // Tasks
  tasks: Task[];
  tasksLoading: boolean;
  createTask: (input: any) => Promise<Task | null>;
  updateTask: (id: string, input: any) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;

  // Journal
  journalEntries: JournalEntry[];
  journalLoading: boolean;
  createJournalEntry: (input: any) => Promise<JournalEntry | null>;
  updateJournalEntry: (id: string, input: any) => Promise<void>;
  deleteJournalEntry: (id: string) => Promise<void>;

  // Vault
  vaultEntries: VaultEntry[];
  vaultLoading: boolean;
  createVaultEntry: (input: any) => Promise<VaultEntry | null>;
  updateVaultEntry: (id: string, input: any) => Promise<void>;
  deleteVaultEntry: (id: string) => Promise<void>;

  // Councils
  councils: CouncilMember[];
  councilsLoading: boolean;
  createCouncilMember: (input: any) => Promise<CouncilMember | null>;
  updateCouncilMember: (id: string, input: any) => Promise<void>;
  deleteCouncilMember: (id: string) => Promise<void>;

  // Skills
  skills: Skill[];
  skillsLoading: boolean;
  createSkill: (input: any) => Promise<Skill | null>;
  updateSkill: (id: string, input: any) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;

  // Energy
  energySystems: EnergySystem[];
  energyLoading: boolean;
  updateEnergy: (id: string, value: number) => Promise<void>;
  createEnergy: (input: any) => Promise<EnergySystem | null>;
  updateEnergyFull: (id: string, input: any) => Promise<void>;
  deleteEnergy: (id: string) => Promise<void>;
  seedDefaultEnergy: () => Promise<void>;

  // Inventory
  inventory: InventoryItem[];
  inventoryLoading: boolean;
  createInventoryItem: (input: any) => Promise<InventoryItem | null>;
  updateInventoryItem: (id: string, input: any) => Promise<void>;
  deleteInventoryItem: (id: string) => Promise<void>;
  refetchInventory: () => Promise<void>;

  // Allies
  allies: Ally[];
  alliesLoading: boolean;
  createAlly: (input: any) => Promise<Ally | null>;
  updateAlly: (id: string, input: any) => Promise<void>;
  deleteAlly: (id: string) => Promise<void>;

  // BPM Sessions
  bpmSessions: BpmSession[];
  bpmLoading: boolean;
  logBpmSession: (input: any) => Promise<BpmSession | null>;

  // Store Items
  storeItems: StoreItem[];
  storeLoading: boolean;
  createStoreItem: (input: any) => Promise<StoreItem | null>;
  updateStoreItem: (id: string, input: any) => Promise<void>;
  deleteStoreItem: (id: string) => Promise<void>;

  // Transformations (Forms)
  transformations: Transformation[];
  transformationsLoading: boolean;
  createTransformation: (input: any) => Promise<Transformation | null>;
  updateTransformation: (id: string, input: any) => Promise<void>;
  deleteTransformation: (id: string) => Promise<void>;
  refetchTransformations: () => Promise<void>;

  // Rankings
  rankings: RankingProfile[];
  rankingsLoading: boolean;
  createRanking: (input: any) => Promise<RankingProfile | null>;
  updateRanking: (id: string, input: any) => Promise<void>;
  deleteRanking: (id: string) => Promise<void>;

  // Domain Effects
  domainEffects: DomainEffect[];
  domainEffectsLoading: boolean;
  createDomainEffect: (input: any) => Promise<DomainEffect | null>;
  updateDomainEffect: (id: string, input: any) => Promise<void>;
  deleteDomainEffect: (id: string) => Promise<void>;
  refetchDomainEffects: () => Promise<void>;

  // Activity log
  logActivity: (event_type: string, description: string, xp?: number) => Promise<void>;

  // Refetch all data (used after MAVIS actions)
  refetchAll: () => Promise<void>;
  // Increments every time refetchAll completes — pages subscribe to auto-refresh
  lastActionTs: number;

  // MAVIS chat state (persists across route changes)
  chatMessages: ChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  chatMode: string;
  setChatMode: (mode: string) => void;
}

export const AppDataContext = createContext<AppDataContextType | null>(null);

export function useAppData(): AppDataContextType {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");  
  return ctx;  
}

const INITIAL_MAVIS_MSG: ChatMessage = {
  id: "init",
  role: "assistant",
  content: "MAVIS-PRIME online. VANTARA.EXE systems nominal. Awaiting your command, Architect.",
  mode: "PRIME",
  timestamp: new Date(),
};

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { profile, loading: profileLoading, updateProfile, awardXP, refetchProfile } = useProfile();
  const { quests, loading: questsLoading, stats: questStats, createQuest, updateQuest, completeQuest, deleteQuest, refetch: refetchQuests } = useQuests();

  const { data: rituals, loading: ritualsLoading, refetch: refetchRituals } = useRituals();
  const { data: tasks, loading: tasksLoading, create: createTask, update: _updateTask, remove: deleteTask, refetch: refetchTasks } = useTasks();

  const updateTask = useCallback(async (id: string, input: any) => {
    if (input.status === "completed") {
      const task = tasks.find((t) => t.id === id);
      if (task) {
        recordAutoMemory("task_complete", {
          title: `Task Completed: ${task.title}`,
          content: `Completed task: "${task.title}"${task.description ? `. ${task.description}` : ""} (${task.type}, ${task.xp_reward ?? 0} XP, streak: ${task.streak ?? 0}).`,
          tags: ["task", task.type ?? "task"],
          metadata: { task_id: id, xp_reward: task.xp_reward, streak: task.streak },
        }).catch(() => {});
      }
    }
    return _updateTask(id, input);
  }, [_updateTask, tasks]);
  const { data: journalEntries, loading: journalLoading, create: createJournalEntry, update: updateJournalEntry, remove: deleteJournalEntry, refetch: refetchJournal } = useJournal();
  const { data: vaultEntries, loading: vaultLoading, create: createVaultEntry, update: updateVaultEntry, remove: deleteVaultEntry, refetch: refetchVault } = useVault();
  const { data: councils, loading: councilsLoading, create: createCouncilMember, update: updateCouncilMember, remove: deleteCouncilMember, refetch: refetchCouncils } = useCouncils();
  const { data: skills, loading: skillsLoading, create: createSkill, update: updateSkill, remove: deleteSkill, refetch: refetchSkills } = useSkills();
  const { systems: energySystems, loading: energyLoading, updateEnergy, createEnergy, updateEnergyFull, deleteEnergy, seedDefaultEnergy, refetch: refetchEnergy } = useEnergySystems();
  const { data: inventory, loading: inventoryLoading, create: createInventoryItem, update: updateInventoryItem, remove: deleteInventoryItem, refetch: refetchInventory } = useInventory();
  const { data: allies, loading: alliesLoading, create: createAlly, update: updateAlly, remove: deleteAlly, refetch: refetchAllies } = useAllies();
  const { data: bpmSessions, loading: bpmLoading, create: logBpmSession, refetch: refetchBpm } = useBpmSessions();
  const { data: storeItems, loading: storeLoading, create: createStoreItem, update: updateStoreItem, remove: deleteStoreItem, refetch: refetchStore } = useStoreItems();
  const { data: transformations, loading: transformationsLoading, create: createTransformation, update: updateTransformation, remove: deleteTransformation, refetch: refetchTransformations } = useTransformations();
  const { data: rankings, loading: rankingsLoading, create: createRanking, update: updateRanking, remove: deleteRanking, refetch: refetchRankings } = useRankings();
  const { data: domainEffects, loading: domainEffectsLoading, create: createDomainEffect, update: updateDomainEffect, remove: deleteDomainEffect, refetch: refetchDomainEffects } = useDomainEffects();
  const { log: logActivity } = useActivityLog();

  const refetchAll = useCallback(async () => {
    await Promise.all([
      refetchProfile(), refetchQuests(), refetchTasks(),
      refetchJournal(), refetchVault(), refetchCouncils(), refetchSkills(),
      refetchEnergy(), refetchInventory(), refetchAllies(), refetchBpm(), refetchStore(), refetchTransformations(), refetchRankings(), refetchRituals(), refetchDomainEffects(),
    ]);
    setLastActionTs(Date.now());
  }, [refetchProfile, refetchQuests, refetchTasks, refetchJournal, refetchVault, refetchCouncils, refetchSkills, refetchEnergy, refetchInventory, refetchAllies, refetchBpm, refetchStore, refetchTransformations, refetchRankings, refetchRituals, refetchDomainEffects]);

  // Supabase Realtime — live sync for core tables
  const realtimeRef = useRef<any>(null);
  useEffect(() => {
    const channel = (supabase as any)
      .channel("vantara-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "quests" }, () => { refetchQuests().catch(() => {}); })
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => { refetchTasks().catch(() => {}); })
      .on("postgres_changes", { event: "*", schema: "public", table: "energy_systems" }, () => { refetchEnergy().catch(() => {}); })
      .on("postgres_changes", { event: "*", schema: "public", table: "journal_entries" }, () => { refetchJournal().catch(() => {}); })
      .on("postgres_changes", { event: "*", schema: "public", table: "skills" }, () => { refetchSkills().catch(() => {}); })
      .on("postgres_changes", { event: "*", schema: "public", table: "allies" }, () => { refetchAllies().catch(() => {}); })
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory" }, () => { refetchInventory().catch(() => {}); })
      .on("postgres_changes", { event: "*", schema: "public", table: "council_members" }, () => { refetchCouncils().catch(() => {}); })
      .on("postgres_changes", { event: "*", schema: "public", table: "transformations" }, () => { refetchTransformations().catch(() => {}); })
      .on("postgres_changes", { event: "*", schema: "public", table: "rituals" }, () => { refetchRituals().catch(() => {}); })
      .on("postgres_changes", { event: "*", schema: "public", table: "mavis_domain_effects" }, () => { refetchDomainEffects().catch(() => {}); })
      .subscribe();
    realtimeRef.current = channel;
    return () => { (supabase as any).removeChannel(channel); };
  }, [refetchQuests, refetchTasks, refetchEnergy, refetchJournal, refetchSkills, refetchAllies, refetchInventory, refetchCouncils, refetchTransformations, refetchRituals, refetchDomainEffects]);

  const [lastActionTs, setLastActionTs] = useState(0);

  // MAVIS chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([INITIAL_MAVIS_MSG]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chatMode, setChatMode] = useState("PRIME");

  return (
    <AppDataContext.Provider
      value={{
        profile, profileLoading, updateProfile, awardXP, refetchProfile,
        quests, questsLoading, questStats, createQuest, updateQuest, completeQuest, deleteQuest, refetchQuests,
        rituals, ritualsLoading,
        tasks, tasksLoading, createTask, updateTask, deleteTask,
        journalEntries, journalLoading, createJournalEntry, updateJournalEntry, deleteJournalEntry,
        vaultEntries, vaultLoading, createVaultEntry, updateVaultEntry, deleteVaultEntry,
        councils, councilsLoading, createCouncilMember, updateCouncilMember, deleteCouncilMember,
        skills, skillsLoading, createSkill, updateSkill, deleteSkill,
        energySystems, energyLoading, updateEnergy, createEnergy, updateEnergyFull, deleteEnergy, seedDefaultEnergy,
        inventory, inventoryLoading, createInventoryItem, updateInventoryItem, deleteInventoryItem, refetchInventory,
        allies, alliesLoading, createAlly, updateAlly, deleteAlly,
        bpmSessions, bpmLoading, logBpmSession,
        storeItems, storeLoading, createStoreItem, updateStoreItem, deleteStoreItem,
        transformations, transformationsLoading, createTransformation, updateTransformation, deleteTransformation, refetchTransformations,
        rankings, rankingsLoading, createRanking, updateRanking, deleteRanking,
        domainEffects, domainEffectsLoading, createDomainEffect, updateDomainEffect, deleteDomainEffect, refetchDomainEffects,
        logActivity,
        refetchAll,
        lastActionTs,
        chatMessages, setChatMessages, conversationId, setConversationId,
        chatMode, setChatMode,
      }}
    >
      {children}
    </AppDataContext.Provider>
  );
}
