/**
 * MAVIS Offline Mode — local-first responses using pre-cached app state.
 *
 * OpenJarvis pattern: skill execution falls back to cached context when
 * the engine is unavailable. MAVIS extends this to full offline awareness:
 *   - Persists last known app state to localStorage after every cloud sync
 *   - Detects offline via navigator.onLine + failed-fetch sentinel
 *   - Generates canned but useful responses for common queries
 *   - Queues mutations for sync when cloud reconnects
 *
 * Offline-capable features (no cloud needed):
 *   - View active quests / tasks
 *   - Check energy levels
 *   - Read vault / journal entries (from local embedding index)
 *   - BM25 semantic search of local knowledge
 *   - Basic MAVIS conversation (via local Ollama if configured)
 */

import type { AppContextSnapshot } from "./appContextLoader";

const SNAPSHOT_KEY  = "mavis-offline-snapshot";
const SNAPSHOT_TS_KEY = "mavis-offline-snapshot-ts";
const QUEUE_KEY     = "mavis-offline-mutation-queue";

// ── Snapshot persistence ──────────────────────────────────────
export function cacheAppState(snapshot: AppContextSnapshot): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
    localStorage.setItem(SNAPSHOT_TS_KEY, String(Date.now()));
  } catch {}
}

export function getCachedSnapshot(): AppContextSnapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getCachedSnapshotAge(): number | null {
  const ts = localStorage.getItem(SNAPSHOT_TS_KEY);
  return ts ? Date.now() - Number(ts) : null;
}

// ── Online/offline detection ──────────────────────────────────
let _forceOffline = false;

export function isOffline(): boolean {
  if (_forceOffline) return true;
  return typeof navigator !== "undefined" && !navigator.onLine;
}

export function setForceOffline(v: boolean): void {
  _forceOffline = v;
}

/** Check connectivity by pinging a lightweight endpoint. */
export async function checkConnectivity(): Promise<boolean> {
  if (!navigator.onLine) return false;
  try {
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ping`, {
      method: "HEAD",
      signal: AbortSignal.timeout(3000),
    });
    return true;
  } catch {
    return false;
  }
}

// ── Offline mutation queue ────────────────────────────────────
export interface OfflineMutation {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export function queueMutation(type: string, payload: Record<string, unknown>): void {
  const queue = getMutationQueue();
  queue.push({ id: crypto.randomUUID(), type, payload, timestamp: Date.now() });
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch {}
}

export function getMutationQueue(): OfflineMutation[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearMutationQueue(): void {
  localStorage.removeItem(QUEUE_KEY);
}

// ── Canned response generation ────────────────────────────────
const OFFLINE_INTENTS: [RegExp, (s: AppContextSnapshot) => string][] = [
  [
    /\b(quests?|missions?|active quest)\b/i,
    (s) => {
      const active = (s.quests ?? []).filter((q: any) => q.status === "active");
      if (!active.length) return "No active quests in your cached data.";
      return `Active Quests (${active.length}):\n` +
        active.slice(0, 8).map((q: any) => `• ${q.title} [${q.type}]`).join("\n");
    },
  ],
  [
    /\b(tasks?|to.?do|today)\b/i,
    (s) => {
      const tasks = (s.tasks ?? []).filter((t: any) => t.status === "active");
      if (!tasks.length) return "No active tasks in your cached data.";
      return `Active Tasks (${tasks.length}):\n` +
        tasks.slice(0, 8).map((t: any) => `• ${t.title} [${t.recurrence}]${t.streak ? ` 🔥${t.streak}` : ""}`).join("\n");
    },
  ],
  [
    /\b(energy|stamina|mana|ki|prana)\b/i,
    (s) => {
      const systems = s.energySystems ?? [];
      if (!systems.length) return "No energy systems in cached data.";
      return `Energy Systems:\n` +
        systems.map((e: any) => `• ${e.type}: ${e.current_value}/${e.max_value} [${e.status}]`).join("\n");
    },
  ],
  [
    /\b(skills?|abilities?|proficiency)\b/i,
    (s) => {
      const skills = (s.skills ?? []).slice(0, 6);
      if (!skills.length) return "No skills in cached data.";
      return `Skills:\n` +
        skills.map((sk: any) => `• ${sk.name} — T${sk.tier} ${sk.proficiency}% (${sk.category})`).join("\n");
    },
  ],
  [
    /\b(profile|level|stats?|xp|rank)\b/i,
    (s) => {
      const p: any = s.profile ?? {};
      if (!p.display_name) return "Profile not in cached data.";
      return [
        `${p.inscribed_name ?? p.display_name} — Lv${p.level} [${p.rank}]`,
        `XP: ${p.xp}/${p.xp_to_next_level}`,
        `STR:${p.stat_str} AGI:${p.stat_agi} INT:${p.stat_int} VIT:${p.stat_vit}`,
        `WIS:${p.stat_wis} CHA:${p.stat_cha} LCK:${p.stat_lck}`,
      ].join("\n");
    },
  ],
];

/**
 * Generate a useful offline response from cached app state.
 * Returns null if no cached state or no matching intent.
 */
export function getOfflineResponse(query: string): string | null {
  if (!isOffline()) return null;
  const snapshot = getCachedSnapshot();
  if (!snapshot) return null;

  const ageMs = getCachedSnapshotAge() ?? 0;
  const ageLabel = ageMs < 60_000 ? "just now"
    : ageMs < 3_600_000 ? `${Math.round(ageMs / 60_000)}m ago`
    : `${Math.round(ageMs / 3_600_000)}h ago`;

  for (const [pattern, generator] of OFFLINE_INTENTS) {
    if (pattern.test(query)) {
      const content = generator(snapshot);
      return `[OFFLINE — cached ${ageLabel}]\n\n${content}`;
    }
  }

  return `[OFFLINE] I'm running in offline mode. I can see your cached data (from ${ageLabel}) for queries about quests, tasks, energy, skills, or your profile. Cloud features need connectivity.`;
}

// ── Context compression (for prompt injection) ────────────────
/**
 * Build a compact context string from cached snapshot for injection
 * into local LLM prompts. Mirrors OpenJarvis's `previous_state` injection.
 */
export function buildOfflineContext(snapshot: AppContextSnapshot): string {
  const lines: string[] = [];
  const p: any = snapshot.profile ?? {};

  if (p.display_name) {
    lines.push(`OPERATOR: ${p.inscribed_name ?? p.display_name} · Lv${p.level} [${p.rank}]`);
  }

  const activeQuests = (snapshot.quests ?? []).filter((q: any) => q.status === "active");
  if (activeQuests.length) {
    lines.push(`ACTIVE QUESTS: ${activeQuests.map((q: any) => q.title).join(", ")}`);
  }

  const activeTasks = (snapshot.tasks ?? []).filter((t: any) => t.status === "active");
  if (activeTasks.length) {
    lines.push(`TASKS: ${activeTasks.slice(0, 5).map((t: any) => t.title).join(", ")}`);
  }

  const energySystems = snapshot.energySystems ?? [];
  if (energySystems.length) {
    lines.push(`ENERGY: ${energySystems.map((e: any) => `${e.type}:${e.current_value}/${e.max_value}`).join(" · ")}`);
  }

  return lines.join("\n");
}
