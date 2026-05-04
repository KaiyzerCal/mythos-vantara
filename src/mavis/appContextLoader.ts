import { supabase } from "@/integrations/supabase/client";

export interface AppContextSnapshot {
  profile: Record<string, unknown> | null;
  quests: unknown[];
  tasks: unknown[];
  skills: unknown[];
  rankings: unknown[];
  transformations: unknown[];
  journalEntries: unknown[];
  vaultEntries: unknown[];
  councilMembers: unknown[];
  inventory: unknown[];
  storeItems: unknown[];
  energySystems: unknown[];
  bpmSessions: unknown[];
  allies: unknown[];
  rituals: unknown[];
  pendingApprovals: unknown[];
  loadedAt: string;
}

async function safeQuery(table: string, userId: string, cols = "*"): Promise<unknown[]> {
  try {
    const { data, error } = await supabase
      .from(table as any)
      .select(cols)
      .eq("user_id", userId);
    if (error) {
      console.warn(`[AppContext] ${table}:`, error.message);
      return [];
    }
    return data ?? [];
  } catch {
    return [];
  }
}

async function safeProfile(userId: string): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (error) return null;
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Fetches ALL user data in parallel from Supabase. */
export async function loadFullAppContext(userId: string): Promise<AppContextSnapshot> {
  const [
    profile,
    quests,
    tasks,
    skills,
    rankings,
    transformations,
    journalEntries,
    vaultEntries,
    councilMembers,
    inventory,
    storeItems,
    energySystems,
    bpmSessions,
    allies,
    rituals,
    pendingApprovals,
  ] = await Promise.all([
    safeProfile(userId),
    safeQuery("quests", userId),
    safeQuery("tasks", userId),
    safeQuery("skills", userId),
    safeQuery("rankings_profiles", userId),
    safeQuery("transformations", userId),
    safeQuery("journal_entries", userId),
    safeQuery("vault_entries", userId),
    safeQuery("councils", userId),
    safeQuery("inventory", userId),
    safeQuery("store_items", userId),
    safeQuery("energy_systems", userId),
    safeQuery("bpm_sessions", userId),
    safeQuery("allies", userId),
    safeQuery("rituals", userId),
    safeQuery("approvals", userId),
  ]);

  return {
    profile,
    quests,
    tasks,
    skills,
    rankings,
    transformations,
    journalEntries,
    vaultEntries,
    councilMembers,
    inventory,
    storeItems,
    energySystems,
    bpmSessions,
    allies,
    rituals,
    pendingApprovals,
    loadedAt: new Date().toISOString(),
  };
}
