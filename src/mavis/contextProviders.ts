/**
 * Context Provider Pipeline — ElizaOS-inspired dynamic context injection.
 * Providers supply live data snippets injected into every MAVIS system prompt.
 * Each provider is a pure async function: (userId) => string | null.
 * Null/empty return means "skip this provider" (e.g., no data available).
 */

import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

export interface ContextProvider {
  name: string;
  priority: number; // Lower = injected first
  ttlMs?: number;   // Cache TTL (0 = always fresh)
  get(userId: string, userMessage?: string): Promise<string | null>;
}

interface CacheEntry { value: string | null; ts: number; }
const _cache = new Map<string, CacheEntry>();

function cached(key: string, ttlMs: number, fn: () => Promise<string | null>): Promise<string | null> {
  const now = Date.now();
  const entry = _cache.get(key);
  if (entry && now - entry.ts < ttlMs) return Promise.resolve(entry.value);
  return fn().then(v => { _cache.set(key, { value: v, ts: now }); return v; });
}

// ── Built-in providers ────────────────────────────────────────────────────────

const timeProvider: ContextProvider = {
  name: "time",
  priority: 1,
  ttlMs: 60_000,
  get: async () => {
    const now = new Date();
    const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    return `CURRENT TIME: ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} | ${dayNames[now.getDay()]}, ${now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
  },
};

const energyProvider: ContextProvider = {
  name: "energy",
  priority: 2,
  ttlMs: 120_000,
  get: async (userId) => cached(`energy:${userId}`, 120_000, async () => {
    const { data } = await supabase.from("energy_systems").select("name, current, max, type").eq("user_id", userId).limit(6);
    if (!data?.length) return null;
    const low = data.filter((e: any) => e.max > 0 && (e.current / e.max) < 0.35);
    const parts = data.map((e: any) => `${e.name}: ${e.current}/${e.max}`).join(" | ");
    const warning = low.length > 0 ? ` ⚠ LOW: ${low.map((e: any) => e.name).join(", ")}` : "";
    return `ENERGY: ${parts}${warning}`;
  }),
};

const activeQuestsProvider: ContextProvider = {
  name: "active_quests",
  priority: 3,
  ttlMs: 300_000,
  get: async (userId) => cached(`quests:${userId}`, 300_000, async () => {
    const { data } = await supabase
      .from("quests")
      .select("title, type, deadline")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("deadline", { ascending: true, nullsFirst: false })
      .limit(5);
    if (!data?.length) return null;
    const lines = data.map((q: any) => {
      const due = q.deadline ? ` (due ${new Date(q.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" })})` : "";
      return `• ${q.title}${due}`;
    });
    return `ACTIVE QUESTS (${data.length}):\n${lines.join("\n")}`;
  }),
};

const pendingTasksProvider: ContextProvider = {
  name: "pending_tasks",
  priority: 4,
  ttlMs: 120_000,
  get: async (userId) => cached(`tasks:${userId}`, 120_000, async () => {
    const { data } = await supabase
      .from("tasks")
      .select("title, recurrence, priority")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("priority", { ascending: false })
      .limit(8);
    if (!data?.length) return null;
    const urgent = data.filter((t: any) => t.priority === "high" || t.priority === "urgent");
    if (!urgent.length) return null;
    return `HIGH PRIORITY TASKS: ${urgent.map((t: any) => t.title).join(" | ")}`;
  }),
};

const recentMemoryProvider: ContextProvider = {
  name: "recent_memories",
  priority: 5,
  ttlMs: 0, // Always fresh — message-dependent
  get: async (userId) => {
    const { data } = await supabase
      .from("mavis_agent_memories")
      .select("content, memory_type, importance")
      .eq("user_id", userId)
      .eq("status", "active")
      .gte("importance", 7)
      .order("created_at", { ascending: false })
      .limit(3);
    if (!data?.length) return null;
    const lines = data.map((m: any) => `• ${String(m.content).slice(0, 120)}`);
    return `RECALLED MEMORIES:\n${lines.join("\n")}`;
  },
};

// ── Registry ──────────────────────────────────────────────────────────────────

const _providers: ContextProvider[] = [
  timeProvider,
  energyProvider,
  activeQuestsProvider,
  pendingTasksProvider,
  recentMemoryProvider,
];

export function registerProvider(provider: ContextProvider): void {
  const idx = _providers.findIndex(p => p.name === provider.name);
  if (idx >= 0) _providers[idx] = provider;
  else _providers.push(provider);
  _providers.sort((a, b) => a.priority - b.priority);
}

export function removeProvider(name: string): void {
  const idx = _providers.findIndex(p => p.name === name);
  if (idx >= 0) _providers.splice(idx, 1);
}

export function invalidateProviderCache(userId: string): void {
  for (const key of _cache.keys()) {
    if (key.includes(userId)) _cache.delete(key);
  }
}

/**
 * Run all providers and return a combined context string.
 * Safe to call before every MAVIS message — results are cached per TTL.
 */
export async function gatherProviderContext(userId: string, userMessage?: string): Promise<string> {
  const results = await Promise.allSettled(
    _providers.map(p => p.get(userId, userMessage))
  );
  const lines: string[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value?.trim()) lines.push(r.value.trim());
  }
  return lines.join("\n");
}
