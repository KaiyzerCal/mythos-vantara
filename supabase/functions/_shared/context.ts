// ─────────────────────────────────────────────────────────────────────────────
// SHARED SOURCE OF TRUTH
// One canonical context block injected into EVERY MAVIS surface:
//   mavis-chat, mavis-agent, mavis-persona-router, mavis-council-session,
//   mavis-actions.
//
// Sections: OPERATOR IDENTITY · TEMPORAL · APP STATE SNAPSHOT · STANDING DIRECTIVES
//
// Design rules:
//   • Single Promise.all, every query independently failure-tolerant
//   • Never throws — a dead table yields an omitted section, never a 500
//   • Size-budgeted so it can't blow the context window
//   • 60s in-memory TTL cache per (userId, entityTimezone)
// ─────────────────────────────────────────────────────────────────────────────

export interface SharedTruthOptions {
  /** Timezone of the speaking entity (persona/council member), if it has its own. */
  entityTimezone?: string | null;
  /** Which surface is asking — shown in the header for debuggability. */
  surface?: string;
  /** Skip the TTL cache. */
  fresh?: boolean;
}

export interface SharedTruth {
  text: string;
  operatorTimezone: string;
  now: Date;
  raw: Record<string, unknown>;
}

const CACHE_TTL_MS = 60_000;
const _cache = new Map<string, { truth: SharedTruth; ts: number }>();

export function invalidateSharedTruth(userId: string): void {
  for (const k of [..._cache.keys()]) if (k.startsWith(userId)) _cache.delete(k);
}

function clip(s: unknown, n: number): string {
  const str = String(s ?? "").replace(/\s+/g, " ").trim();
  return str.length > n ? str.slice(0, n) + "…" : str;
}

/** Runs a query, returning `fallback` on any error or timeout. */
async function safe<T>(p: PromiseLike<{ data: T | null }>, fallback: T, ms = 6000): Promise<T> {
  try {
    const res = await Promise.race([
      Promise.resolve(p),
      new Promise<{ data: null }>((r) => setTimeout(() => r({ data: null }), ms)),
    ]);
    return ((res as { data: T | null })?.data ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function fmt(now: Date, tz: string): { date: string; time: string } {
  try {
    return {
      date: now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: tz }),
      time: now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZoneName: "short", timeZone: tz }),
    };
  } catch {
    return { date: now.toDateString(), time: now.toUTCString() };
  }
}

/**
 * Build the canonical shared context block for a user.
 * Safe to call on every message — cached for 60s.
 */
export async function buildSharedTruth(
  supabase: any,
  userId: string,
  opts: SharedTruthOptions = {},
): Promise<SharedTruth> {
  const cacheKey = `${userId}::${opts.entityTimezone ?? ""}`;
  if (!opts.fresh) {
    const hit = _cache.get(cacheKey);
    // Cache the data, but always re-render the clock.
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
      return renderFromRaw(hit.truth.raw, opts);
    }
  }

  const sb = supabase;
  const [
    profile,
    userProfile,
    quests,
    tasks,
    energy,
    goals,
    approvals,
    actionQueue,
    memories,
    worldModel,
    tacit,
    learned,
  ] = await Promise.all([
    safe<any>(sb.from("profiles").select("display_name, title, location, timezone, level, xp").eq("id", userId).maybeSingle(), null),
    safe<any>(sb.from("mavis_user_profile").select("profile_md, communication_style, key_context, preferences, topics_of_interest").eq("user_id", userId).maybeSingle(), null),
    safe<any[]>(sb.from("quests").select("title, type, deadline, status").eq("user_id", userId).eq("status", "active").order("deadline", { ascending: true, nullsFirst: false }).limit(8), []),
    safe<any[]>(sb.from("tasks").select("title, priority, status").eq("user_id", userId).eq("status", "active").order("priority", { ascending: false }).limit(8), []),
    safe<any[]>(sb.from("energy_systems").select("name, current, max").eq("user_id", userId).limit(6), []),
    safe<any[]>(sb.from("mavis_goals").select("objective, context").eq("user_id", userId).eq("status", "active").limit(5), []),
    safe<any[]>(sb.from("approvals").select("id, title, status").eq("user_id", userId).eq("status", "pending").limit(5), []),
    safe<any[]>(sb.from("mavis_action_queue").select("id, action_type, status").eq("user_id", userId).eq("status", "pending").limit(10), []),
    safe<any[]>(sb.from("mavis_agent_memories").select("content, memory_type, importance").eq("user_id", userId).eq("status", "active").gte("importance", 7).order("created_at", { ascending: false }).limit(5), []),
    safe<any>(sb.from("mavis_world_model").select("summary, trajectory, key_insights, opportunities, risks").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(), null),
    safe<any[]>(sb.from("mavis_tacit").select("category, key, value, confidence").eq("user_id", userId).order("confidence", { ascending: false }).limit(40), []),
    safe<any[]>(sb.from("mavis_learned_preferences").select("key, value").eq("user_id", userId).limit(10), []),
  ]);

  const raw = {
    profile, userProfile, quests, tasks, energy, goals,
    approvals, actionQueue, memories, worldModel, tacit, learned,
  };

  const truth = renderFromRaw(raw, opts);
  _cache.set(cacheKey, { truth, ts: Date.now() });
  return truth;
}

function renderFromRaw(raw: Record<string, any>, opts: SharedTruthOptions): SharedTruth {
  const {
    profile, userProfile, quests, tasks, energy, goals,
    approvals, actionQueue, memories, worldModel, tacit, learned,
  } = raw;

  const now = new Date();
  const operatorTz: string = profile?.timezone || "UTC";
  const entityTz = opts.entityTimezone || null;
  const opDt = fmt(now, operatorTz);
  const entDt = entityTz ? fmt(now, entityTz) : null;

  const S: string[] = [];

  // ── OPERATOR IDENTITY ──────────────────────────────────────────────────────
  const id: string[] = [];
  if (profile?.display_name) id.push(`Name: ${profile.display_name}`);
  if (profile?.title)        id.push(`Role: ${profile.title}`);
  if (profile?.location)     id.push(`Location: ${profile.location}`);
  if (profile?.level != null) id.push(`Level ${profile.level}${profile?.xp != null ? ` · ${profile.xp} XP` : ""}`);
  if (userProfile?.profile_md)          id.push(`\nWHO THEY ARE:\n${clip(userProfile.profile_md, 1200)}`);
  if (userProfile?.communication_style) id.push(`\nCOMMUNICATION STYLE: ${clip(userProfile.communication_style, 300)}`);
  if (userProfile?.key_context)         id.push(`\nSTANDING CONTEXT:\n${clip(userProfile.key_context, 700)}`);
  if (Array.isArray(userProfile?.topics_of_interest) && userProfile.topics_of_interest.length)
    id.push(`INTERESTS: ${userProfile.topics_of_interest.slice(0, 12).join(", ")}`);
  if (userProfile?.preferences && typeof userProfile.preferences === "object") {
    const pl = Object.entries(userProfile.preferences).slice(0, 8).map(([k, v]) => `${k}=${clip(v, 60)}`);
    if (pl.length) id.push(`PREFERENCES: ${pl.join(" · ")}`);
  }
  if (id.length) S.push(`─── OPERATOR IDENTITY ───\n${id.join("\n")}`);

  // ── TEMPORAL ───────────────────────────────────────────────────────────────
  S.push(
    `─── TEMPORAL ───\n` +
    (entDt
      ? `YOUR LOCAL TIME: ${entDt.date}, ${entDt.time} [${entityTz}]\nOPERATOR LOCAL: ${opDt.date}, ${opDt.time} [${operatorTz}]`
      : `OPERATOR LOCAL: ${opDt.date}, ${opDt.time} [${operatorTz}]`) +
    `\nISO/UTC: ${now.toISOString()}\n` +
    `Always speak in ${entityTz ?? operatorTz} time. Never show UTC unless asked.`,
  );

  // ── APP STATE SNAPSHOT ─────────────────────────────────────────────────────
  const snap: string[] = [];
  if (quests?.length) {
    snap.push(`ACTIVE QUESTS (${quests.length}):\n` + quests.slice(0, 6).map((q: any) =>
      `  • ${clip(q.title, 80)}${q.deadline ? ` (due ${String(q.deadline).slice(0, 10)})` : ""}`).join("\n"));
  }
  if (tasks?.length) {
    const hi = tasks.filter((t: any) => t.priority === "high" || t.priority === "urgent");
    snap.push(`ACTIVE TASKS (${tasks.length})${hi.length ? ` — high priority: ${hi.slice(0, 5).map((t: any) => clip(t.title, 50)).join(", ")}` : ""}`);
  }
  if (goals?.length) {
    snap.push(`ACTIVE GOALS:\n` + goals.map((g: any) => `  • ${clip(g.objective, 90)}`).join("\n"));
  }
  if (energy?.length) {
    const parts = energy.map((e: any) => `${e.name}: ${e.current}/${e.max}`);
    const low = energy.filter((e: any) => e.max > 0 && e.current / e.max < 0.35).map((e: any) => e.name);
    snap.push(`ENERGY: ${parts.join(" | ")}${low.length ? `  ⚠ LOW: ${low.join(", ")}` : ""}`);
  }
  const pending = (approvals?.length ?? 0) + (actionQueue?.length ?? 0);
  if (pending) {
    snap.push(`PENDING: ${approvals?.length ?? 0} approval(s), ${actionQueue?.length ?? 0} queued action(s)` +
      (actionQueue?.length ? ` [${[...new Set(actionQueue.map((a: any) => a.action_type))].slice(0, 5).join(", ")}]` : ""));
  }
  if (memories?.length) {
    snap.push(`SALIENT MEMORIES:\n` + memories.map((m: any) => `  • ${clip(m.content, 140)}`).join("\n"));
  }
  if (worldModel?.summary) {
    const ins = Array.isArray(worldModel.key_insights) ? worldModel.key_insights.slice(0, 3).join(" | ") : "";
    const opp = Array.isArray(worldModel.opportunities) ? worldModel.opportunities.slice(0, 2).join(" | ") : "";
    const rsk = Array.isArray(worldModel.risks) ? worldModel.risks.slice(0, 2).join(" | ") : "";
    snap.push(`WORLD MODEL: ${clip(worldModel.summary, 600)}` +
      (worldModel.trajectory ? `\n  Trajectory: ${clip(worldModel.trajectory, 200)}` : "") +
      (ins ? `\n  Insights: ${clip(ins, 300)}` : "") +
      (opp ? `\n  Opportunities: ${clip(opp, 200)}` : "") +
      (rsk ? `\n  Risks: ${clip(rsk, 200)}` : ""));
  }
  if (snap.length) S.push(`─── APP STATE SNAPSHOT ───\n${snap.join("\n")}`);

  // ── STANDING DIRECTIVES ────────────────────────────────────────────────────
  const dir: string[] = [];
  if (tacit?.length) {
    const hard = tacit.filter((t: any) => t.category === "hard_rule");
    const prefs = tacit.filter((t: any) => t.category === "preference");
    const orders = tacit.filter((t: any) => t.category === "standing_order");
    if (hard.length)   dir.push(`HARD RULES (obey unconditionally):\n${hard.map((r: any) => `  • [${r.key}] ${clip(r.value, 160)}`).join("\n")}`);
    if (prefs.length)  dir.push(`PREFERENCES:\n${prefs.slice(0, 10).map((r: any) => `  • [${r.key}] ${clip(r.value, 140)}`).join("\n")}`);
    if (orders.length) dir.push(`STANDING ORDERS:\n${orders.slice(0, 10).map((r: any) => `  • [${r.key}] ${clip(Array.isArray(r.value) ? r.value.join(", ") : r.value, 140)}`).join("\n")}`);
  }
  if (learned?.length) {
    dir.push(`LEARNED PREFERENCES: ${learned.map((l: any) => `${l.key}=${clip(l.value, 60)}`).join(" · ")}`);
  }
  if (dir.length) S.push(`─── STANDING DIRECTIVES ───\n${dir.join("\n\n")}`);

  const header = `═══════════ SHARED SOURCE OF TRUTH${opts.surface ? ` · ${opts.surface}` : ""} ═══════════`;
  const text = `\n\n${header}\nThis block is identical across MAVIS, agent mode, personas, and council members. It is the single authoritative view of the operator and the app.\n\n${S.join("\n\n")}\n═══════════ END SHARED SOURCE OF TRUTH ═══════════\n`;

  return { text, operatorTimezone: operatorTz, now, raw };
}
