// ============================================================
// VANTARA.EXE — Data Hooks Bundle
// useTasks | useRituals | useJournal | useVault | useCouncils | useEnergy | useSkills
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// ─── helpers ───────────────────────────────────────────────
function makeHook<T extends { id: string }>(tableName: string) {
  return function useTableData() {
    const { user } = useAuth();
    const [data, setData] = useState<T[]>([]);
    const [loading, setLoading] = useState(true);

    const fetch = useCallback(async () => {
      if (!user) return;
      const { data: rows } = await (supabase as any)
        .from(tableName)
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (rows) setData(rows as unknown as T[]);
      setLoading(false);
    }, [user]);

    useEffect(() => { fetch(); }, [fetch]);

    const create = useCallback(async (input: Omit<T, "id" | "user_id" | "created_at" | "updated_at">): Promise<T | null> => {
      if (!user) return null;
      const { data: row, error } = await (supabase as any)
        .from(tableName)
        .insert({ ...input, user_id: user.id })
        .select()
        .single();
      if (error || !row) return null;
      setData((prev) => [row as unknown as T, ...prev]);
      return row as unknown as T;
    }, [user]);

    const update = useCallback(async (id: string, input: Partial<T>) => {
      setData((prev) => prev.map((row) => (row.id === id ? { ...row, ...input } : row)));
      await (supabase as any).from(tableName).update({ ...input, updated_at: new Date().toISOString() }).eq("id", id);
    }, []);

    const remove = useCallback(async (id: string) => {
      setData((prev) => prev.filter((row) => row.id !== id));
      await (supabase as any).from(tableName).delete().eq("id", id);
    }, []);

    return { data, loading, create, update, remove, refetch: fetch };
  };
}

// ─── TASKS ─────────────────────────────────────────────────
export interface Task {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  type: "task" | "habit";
  status: "active" | "completed" | "archived";
  recurrence: "once" | "daily" | "weekly" | "monthly";
  xp_reward: number;
  linked_skill_id: string | null;
  streak: number;
  completed_count: number;
  last_completed: string | null;
  created_at: string;
  updated_at: string;
}
export const useTasks = makeHook<Task>("tasks");

// ─── RITUALS ───────────────────────────────────────────────
export interface Ritual {
  id: string;
  user_id: string;
  name: string;
  description: string;
  type: "legal" | "business" | "self_care" | "fitness" | "other";
  category: string | null;
  xp_reward: number;
  completed: boolean;
  streak: number;
  last_completed: string | null;
  created_at: string;
}
export const useRituals = makeHook<Ritual>("rituals");

// ─── JOURNAL ───────────────────────────────────────────────
export interface JournalEntry {
  id: string;
  user_id: string;
  title: string;
  content: string;
  tags: string[];
  category: string;
  importance: "low" | "medium" | "high" | "critical";
  mood: string | null;
  xp_earned: number;
  created_at: string;
  updated_at: string;
}
export const useJournal = makeHook<JournalEntry>("journal_entries");

// ─── VAULT ─────────────────────────────────────────────────
export interface VaultEntry {
  id: string;
  user_id: string;
  title: string;
  content: string;
  category: "legal" | "business" | "personal" | "evidence" | "achievement";
  importance: "low" | "medium" | "high" | "critical";
  attachments: string[];
  created_at: string;
  updated_at: string;
}
export const useVault = makeHook<VaultEntry>("vault_entries");

// ─── COUNCILS ──────────────────────────────────────────────
export interface CouncilMember {
  id: string;
  user_id: string;
  name: string;
  role: string;
  specialty: string | null;
  class: "core" | "advisory" | "think-tank" | "shadows";
  notes: string;
  avatar: string | null;
  created_at: string;
  updated_at: string;
}
export const useCouncils = makeHook<CouncilMember>("councils");

// ─── SKILLS ────────────────────────────────────────────────
export interface Skill {
  id: string;
  user_id: string;
  name: string;
  description: string;
  category: string;
  energy_type: string;
  tier: number;
  unlocked: boolean;
  cost: number;
  proficiency: number;
  prerequisites: string[];
  parent_skill_id: string | null;
  created_at: string;
  updated_at: string;
}
export const useSkills = makeHook<Skill>("skills");

// ─── ENERGY SYSTEMS ────────────────────────────────────────
export interface EnergySystem {
  id: string;
  user_id: string;
  type: string;
  current_value: number;
  max_value: number;
  color: string;
  description: string;
  status: "mastered" | "advanced" | "developing" | "perfect";
  updated_at: string;
}

export function useEnergySystems() {
  const { user } = useAuth();
  const [systems, setSystems] = useState<EnergySystem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("energy_systems")
      .select("*")
      .eq("user_id", user.id)
      .order("type");
    if (data) setSystems(data as EnergySystem[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);

  const updateEnergy = useCallback(async (id: string, current_value: number) => {
    setSystems((prev) =>
      prev.map((s) => (s.id === id ? { ...s, current_value } : s))
    );
    await supabase
      .from("energy_systems")
      .update({ current_value, updated_at: new Date().toISOString() })
      .eq("id", id);
  }, []);

  const createEnergy = useCallback(async (input: Omit<EnergySystem, "id" | "user_id" | "updated_at">): Promise<EnergySystem | null> => {
    if (!user) return null;
    const { data, error } = await supabase
      .from("energy_systems")
      .insert({ ...input, user_id: user.id })
      .select()
      .single();
    if (error || !data) return null;
    setSystems((prev) => [...prev, data as EnergySystem]);
    return data as EnergySystem;
  }, [user]);

  const updateEnergyFull = useCallback(async (id: string, input: Partial<EnergySystem>) => {
    setSystems((prev) => prev.map((s) => (s.id === id ? { ...s, ...input } : s)));
    await supabase.from("energy_systems").update({ ...input, updated_at: new Date().toISOString() }).eq("id", id);
  }, []);

  const deleteEnergy = useCallback(async (id: string) => {
    setSystems((prev) => prev.filter((s) => s.id !== id));
    await supabase.from("energy_systems").delete().eq("id", id);
  }, []);

  const seedDefaultEnergy = useCallback(async () => {
    if (!user || systems.length > 0) return;
    const defaults = [
      { type: "Ki", current_value: 100, max_value: 100, color: "#FFD700", description: "Physical vitality & inner power", status: "mastered" },
      { type: "Aura", current_value: 95, max_value: 100, color: "#00D9FF", description: "Spiritual presence & life force", status: "advanced" },
      { type: "Nen", current_value: 100, max_value: 100, color: "#4169E1", description: "Life energy with six categories", status: "mastered" },
      { type: "Haki", current_value: 100, max_value: 100, color: "#8B0000", description: "Willpower & sensory dominance", status: "mastered" },
      { type: "Chakra", current_value: 95, max_value: 100, color: "#1E90FF", description: "Spiritual + physical energy for jutsu", status: "advanced" },
      { type: "Cursed Energy", current_value: 100, max_value: 100, color: "#6A0DAD", description: "Negative emotions weaponized", status: "mastered" },
      { type: "Mana", current_value: 90, max_value: 100, color: "#00CED1", description: "Arcane energy for magic casting", status: "advanced" },
      { type: "VRIL", current_value: 95, max_value: 100, color: "#FF4500", description: "Ancient bio-energy of the earth", status: "advanced" },
      { type: "Black Heart", current_value: 100, max_value: 100, color: "#111111", description: "Consciousness = Reality", status: "mastered" },
      { type: "Emerald Flames", current_value: 100, max_value: 100, color: "#08C284", description: "Abraxas + Azaroth fusion", status: "perfect" },
    ].map((e) => ({ ...e, user_id: user.id }));
    await supabase.from("energy_systems").insert(defaults);
    await fetch();
  }, [user, systems.length, fetch]);

  return { systems, loading, updateEnergy, createEnergy, updateEnergyFull, deleteEnergy, seedDefaultEnergy, refetch: fetch };
}

// ─── INVENTORY ─────────────────────────────────────────────
export interface InventoryItem {
  id: string;
  user_id: string;
  name: string;
  description: string;
  type: "consumable" | "equipment" | "material" | "artifact";
  rarity: "common" | "rare" | "epic" | "legendary" | "mythic";
  quantity: number;
  effect: string | null;
  slot: string | null;
  tier: string | null;
  stat_effects: { label: string; value: number; unit: string }[];
  is_equipped: boolean;
  obtained_at: string;
}
export const useInventory = makeHook<InventoryItem>("inventory");

// ─── ALLIES ────────────────────────────────────────────────
export interface Ally {
  id: string;
  user_id: string;
  name: string;
  relationship: "ally" | "council" | "rival";
  level: number;
  specialty: string;
  affinity: number;
  avatar: string | null;
  notes: string;
  created_at: string;
}
export const useAllies = makeHook<Ally>("allies");

// ─── BPM SESSIONS ──────────────────────────────────────────
export interface BpmSession {
  id: string;
  user_id: string;
  bpm: number;
  form: string;
  duration: number;
  mood: string | null;
  notes: string | null;
  created_at: string;
}
export const useBpmSessions = makeHook<BpmSession>("bpm_sessions");

// ─── STORE ITEMS ───────────────────────────────────────────
export interface StoreItem {
  id: string;
  user_id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  rarity: string;
  category: string;
  effect: string | null;
  req_level: number | null;
  req_rank: string | null;
  created_at: string;
  updated_at: string;
}
export const useStoreItems = makeHook<StoreItem>("store_items");

// ─── ACTIVITY LOG (append-only) ────────────────────────────
export function useActivityLog() {
  const { user } = useAuth();

  const log = useCallback(
    async (event_type: string, description: string, xp_amount = 0) => {
      if (!user) return;
      await supabase.from("activity_log").insert({
        user_id: user.id,
        event_type,
        description,
        xp_amount,
      });
    },
    [user]
  );

  return { log };
}
