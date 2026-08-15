// ============================================================
// VANTARA.EXE — Data Hooks Bundle
// useTasks | useRituals | useJournal | useVault | useCouncils | useEnergy | useSkills
// ============================================================
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { withTransientRetry } from "@/lib/retryTransientFetch";

// ─── helpers ───────────────────────────────────────────────
// AppDataProvider mounts every one of these hooks at once, so all of them
// fire their initial fetch on every app boot regardless of which page is
// open — roughly 600 kB of rows (well over 1 MB once JSON-encoded) across
// ~17 parallel queries, which is slow on mobile. `deferInitial` marks the
// tables no page needs in its first paint (the heaviest ones: vault_entries
// ~225 kB, councils ~157 kB, transformations ~54 kB) so they yield the
// connection to the dashboard-critical tables and load right after, instead
// of competing with them. Nothing is skipped — only reordered — and every
// consumer already renders off `loading`, so a slightly later arrival is
// already a state they handle.
function scheduleAfterFirstPaint(run: () => void): () => void {
  const ric = (window as any).requestIdleCallback as
    | ((cb: () => void, opts?: { timeout: number }) => number)
    | undefined;
  if (ric) {
    const handle = ric(run, { timeout: 2000 });
    return () => (window as any).cancelIdleCallback?.(handle);
  }
  const t = setTimeout(run, 300);
  return () => clearTimeout(t);
}

function makeHook<T extends { id: string }>(
  tableName: string,
  options?: { orderColumn?: string; ascending?: boolean; deferInitial?: boolean }
) {
  return function useTableData() {
    const { user } = useAuth();
    const [data, setData] = useState<T[]>([]);
    const [loading, setLoading] = useState(true);
    const orderColumn = options?.orderColumn ?? "created_at";
    const ascending = options?.ascending ?? false;
    // Dedupe concurrent fetches (realtime bursts + manual refetchAll can overlap)
    const inflight = useRef<Promise<void> | null>(null);

    const fetch = useCallback(async () => {
      if (!user) return;
      if (inflight.current) return inflight.current;
      const run = (async () => {
        const { data: rows, error } = await withTransientRetry<{ data: unknown[] | null; error: unknown }>(() =>
          (supabase as any)
            .from(tableName)
            .select("*")
            .eq("user_id", user.id)
            .order(orderColumn, { ascending })
            .limit(500)
        );
        if (error) {
          console.error(`[useDataHooks] Error fetching ${tableName}:`, error);
        }
        if (rows) setData(rows as unknown as T[]);
        setLoading(false);
      })();
      inflight.current = run;
      try { await run; } finally { inflight.current = null; }
    }, [orderColumn, tableName, user]);

    useEffect(() => {
      if (!options?.deferInitial) { fetch(); return; }
      return scheduleAfterFirstPaint(() => { fetch(); });
    }, [fetch]);

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
      const { error } = await (supabase as any).from(tableName).update({ ...input, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) {
        console.error(`[useDataHooks] Error updating ${tableName}:`, error);
        toast.error(`Failed to save changes — reverting`);
        await fetch();
      }
    }, [fetch]);

    const remove = useCallback(async (id: string) => {
      setData((prev) => prev.filter((row) => row.id !== id));
      const { error } = await (supabase as any).from(tableName).delete().eq("id", id);
      if (error) {
        console.error(`[useDataHooks] Error deleting from ${tableName}:`, error);
        toast.error(`Failed to delete — reverting`);
        await fetch();
      }
    }, [fetch]);

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
export const useTasks = makeHook<Task>("tasks", { deferInitial: true });

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
export const useRituals = makeHook<Ritual>("rituals", { deferInitial: true });

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
// Journal entries carry long-form text content, unlike the mostly-structured
// rows in other tables -- same "heavy, not dashboard-critical" shape as
// vault_entries/councils/transformations above, but was missing the same
// deferInitial treatment every sibling hook in this file has.
export const useJournal = makeHook<JournalEntry>("journal_entries", { deferInitial: true });

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
export const useVault = makeHook<VaultEntry>("vault_entries", { deferInitial: true });

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
export const useCouncils = makeHook<CouncilMember>("councils", { deferInitial: true });

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
export const useSkills = makeHook<Skill>("skills", { deferInitial: true });

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
    const { data } = await withTransientRetry(() =>
      supabase
        .from("energy_systems")
        .select("*")
        .eq("user_id", user.id)
        .order("type")
    );
    if (data) setSystems(data as EnergySystem[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);

  const updateEnergy = useCallback(async (id: string, current_value: number) => {
    setSystems((prev) =>
      prev.map((s) => (s.id === id ? { ...s, current_value } : s))
    );
    const { error } = await supabase
      .from("energy_systems")
      .update({ current_value, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      console.error("[useDataHooks] Error updating energy_systems:", error);
      toast.error("Failed to save changes — reverting");
      await fetch();
    }
  }, [fetch]);

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
    const { error } = await supabase.from("energy_systems").update({ ...input, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      console.error("[useDataHooks] Error updating energy_systems:", error);
      toast.error("Failed to save changes — reverting");
      await fetch();
    }
  }, [fetch]);

  const deleteEnergy = useCallback(async (id: string) => {
    setSystems((prev) => prev.filter((s) => s.id !== id));
    const { error } = await supabase.from("energy_systems").delete().eq("id", id);
    if (error) {
      console.error("[useDataHooks] Error deleting from energy_systems:", error);
      toast.error("Failed to delete — reverting");
      await fetch();
    }
  }, [fetch]);

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
  type: "consumable" | "equipment" | "material" | "artifact" | "weapon";
  rarity: "common" | "rare" | "epic" | "legendary" | "mythic";
  quantity: number;
  effect: string | null;
  slot: string | null;
  tier: string | null;
  stat_effects: { label: string; value: number; unit: string }[];
  is_equipped: boolean;
  obtained_at: string;
}
export const useInventory = makeHook<InventoryItem>("inventory", { orderColumn: "obtained_at", deferInitial: true });

// ─── DOMAIN EFFECTS ────────────────────────────────────────
export interface DomainEffect {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  effect_type: "domain" | "curse" | "terrain" | "environmental" | "aura" | "zone";
  stat_modifiers: { label: string; value: number; unit: string }[];
  area_effects: string[];
  is_active: boolean;
  expires_at: string | null;
  source: string | null;
  created_at: string;
}
export const useDomainEffects = makeHook<DomainEffect>("mavis_domain_effects", { orderColumn: "created_at", deferInitial: true });

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
export const useAllies = makeHook<Ally>("allies", { deferInitial: true });

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
export const useBpmSessions = makeHook<BpmSession>("bpm_sessions", { deferInitial: true });

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
export const useStoreItems = makeHook<StoreItem>("store_items", { deferInitial: true });

// ─── CURRENCIES ────────────────────────────────────────────
// Backs the Store's purchase flow. The `currencies` table predates this hook
// (see migrations) but was never wired to the frontend, which is why "Buy"
// used to just flip local UI state. It has no updated_at column, so it can't
// use the shared makeHook() above (that unconditionally sets updated_at).
export interface Currency {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  icon: string;
  created_at: string;
}

export function useCurrencies() {
  const { user } = useAuth();
  const [data, setData] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user) return;
    const { data: rows, error } = await withTransientRetry<{ data: unknown[] | null; error: unknown }>(() =>
      (supabase as any)
        .from("currencies").select("*").eq("user_id", user.id).order("name", { ascending: true })
    );
    if (error) console.error("[useDataHooks] Error fetching currencies:", error);
    if (rows) setData(rows as unknown as Currency[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = useCallback(async (input: { name: string; amount: number; icon?: string }): Promise<Currency | null> => {
    if (!user) return null;
    const { data: row, error } = await (supabase as any)
      .from("currencies")
      .insert({ name: input.name, amount: input.amount, icon: input.icon ?? "💰", user_id: user.id })
      .select().single();
    if (error || !row) return null;
    setData((prev) => [...prev, row as unknown as Currency].sort((a, b) => a.name.localeCompare(b.name)));
    return row as unknown as Currency;
  }, [user]);

  const setAmount = useCallback(async (id: string, amount: number) => {
    setData((prev) => prev.map((c) => (c.id === id ? { ...c, amount } : c)));
    const { error } = await (supabase as any).from("currencies").update({ amount }).eq("id", id);
    if (error) {
      console.error("[useDataHooks] Error updating currency:", error);
      toast.error("Failed to save — reverting");
      await fetch();
    }
  }, [fetch]);

  const remove = useCallback(async (id: string) => {
    setData((prev) => prev.filter((c) => c.id !== id));
    const { error } = await (supabase as any).from("currencies").delete().eq("id", id);
    if (error) {
      console.error("[useDataHooks] Error deleting currency:", error);
      await fetch();
    }
  }, [fetch]);

  // Re-checks the live balance rather than trusting client state — this is
  // the actual gate a Store purchase goes through.
  const spend = useCallback(async (name: string, amount: number): Promise<{ ok: boolean; balance: number }> => {
    if (!user) return { ok: false, balance: 0 };
    const { data: row } = await (supabase as any)
      .from("currencies").select("id, amount").eq("user_id", user.id).ilike("name", name).maybeSingle();
    const balance = row?.amount ?? 0;
    if (!row || balance < amount) return { ok: false, balance };
    const nextAmount = balance - amount;
    const { error } = await (supabase as any).from("currencies").update({ amount: nextAmount }).eq("id", row.id);
    if (error) return { ok: false, balance };
    setData((prev) => prev.map((c) => (c.id === row.id ? { ...c, amount: nextAmount } : c)));
    return { ok: true, balance: nextAmount };
  }, [user]);

  return { data, loading, create, setAmount, remove, spend, refetch: fetch };
}

// ─── TRANSFORMATIONS (Forms) ──────────────────────────────
export interface Transformation {
  id: string;
  user_id: string;
  name: string;
  tier: string;
  form_order: number;
  bpm_range: string;
  energy: string;
  jjk_grade: string;
  op_tier: string;
  category: string | null;
  description: string | null;
  unlocked: boolean;
  active_buffs: any;
  passive_buffs: any;
  abilities: any;
  created_at: string;
}
export const useTransformations = makeHook<Transformation>("transformations", { orderColumn: "form_order", ascending: true, deferInitial: true });

// ─── RANKINGS PROFILES ────────────────────────────────────
export interface RankingProfile {
  id: string;
  user_id: string;
  display_name: string;
  role: string;
  rank: string;
  level: number;
  jjk_grade: string;
  op_tier: string;
  gpr: number;
  pvp: number;
  influence: string;
  notes: string;
  is_self: boolean;
  source_transformation_id: string | null;
  created_at: string;
  updated_at: string;
}
export const useRankings = makeHook<RankingProfile>("rankings_profiles", { deferInitial: true });

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
