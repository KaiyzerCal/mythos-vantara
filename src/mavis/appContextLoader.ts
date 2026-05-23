import { supabase as _supabase } from "@/integrations/supabase/client";
import { rebuildIndexFromSnapshot } from "@/mavis/localEmbeddings";
const supabase = _supabase as any;

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
  pendingApprovals: unknown[];
  personas: unknown[];
  loadedAt: string;
}

async function safeQuery(table: string, userId: string, cols = "*"): Promise<unknown[]> {
  const ALLOWED = new Set(["quests","tasks","skills","rankings_profiles","transformations","journal_entries","vault_entries","council_members","inventory","store_items","energy_systems","bpm_sessions","allies","personas","mavis_tasks"]);
  if (!ALLOWED.has(table)) { console.warn(`[AppContext] Blocked query to unknown table: ${table}`); return []; }
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

// ── 60-second in-memory cache ─────────────────────────────────────────────────
// Avoids reloading 16 Supabase tables on every message in the same session.
// Invalidated on successful MAVIS actions via invalidateAppContext().
const _cache = new Map<string, { snapshot: AppContextSnapshot; ts: number }>();
const CACHE_TTL_MS = 60_000;

export function invalidateAppContext(userId: string): void {
  _cache.delete(userId);
}

/** Fetches ALL user data in parallel from Supabase (cached 60s). */
export async function loadFullAppContext(userId: string): Promise<AppContextSnapshot> {
  const cached = _cache.get(userId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.snapshot;

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
    pendingApprovals,
    personas,
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
    safeQuery("approvals", userId),
    safeQuery("personas", userId),
  ]);

  const snapshot: AppContextSnapshot = {
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
    pendingApprovals,
    personas,
    loadedAt: new Date().toISOString(),
  };

  _cache.set(userId, { snapshot, ts: Date.now() });

  // Rebuild BM25 index for offline/local search
  rebuildIndexFromSnapshot(snapshot).catch(() => {});

  return snapshot;
}
