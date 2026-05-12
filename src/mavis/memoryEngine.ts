// Three-layer memory system — Felix-equivalent, Supabase-native
// Layer 1: Knowledge graph (PARA) → mavis_knowledge
// Layer 2: Session logs          → mavis_memory
// Layer 3: Tacit knowledge       → mavis_tacit

import type { MavisMessage } from "./types";
import { supabase } from "@/integrations/supabase/client";

// ─────────────────────────────────────────────────────────────
// SESSION STATE
// ─────────────────────────────────────────────────────────────

let _buffer: MavisMessage[] = [];
let _sessionId: string = crypto.randomUUID();
let _userId: string = "";

export function initSession(userId: string, sessionId?: string): void {
  _userId = userId;
  _sessionId = sessionId ?? crypto.randomUUID();
  _buffer = [];
}

export function getSessionId(): string { return _sessionId; }
export function getMessages(): MavisMessage[] { return [..._buffer]; }
export function getLastN(n: number): MavisMessage[] { return _buffer.slice(-n); }
export function clearBuffer(): void { _buffer = []; }

export function makeMessage(role: MavisMessage["role"], content: string): MavisMessage {
  return { id: crypto.randomUUID(), role, content, timestamp: Date.now() };
}

// Legacy shims (used by MavisChat.tsx)
export function addMessage(msg: MavisMessage): void {
  _buffer = [..._buffer, msg];
  if (_userId) {
    supabase.from("mavis_memory").insert({
      user_id: _userId,
      session_id: _sessionId,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
    }).then(({ error }) => {
      if (error) console.warn("[Memory L2] Persist failed:", error.message);
    });
  }
}

export function clearMessages(): void { _buffer = []; }
export function serializeMessages(): string { return JSON.stringify(_buffer); }
export function loadMessages(serialized: string): void {
  try {
    const parsed = JSON.parse(serialized) as MavisMessage[];
    if (Array.isArray(parsed)) _buffer = parsed;
  } catch { console.warn("[MAVIS:MemoryEngine] Failed to load messages"); }
}

// ─────────────────────────────────────────────────────────────
// LAYER 2 — SESSION LOGS
// ─────────────────────────────────────────────────────────────

export async function addMessageAsync(msg: MavisMessage): Promise<void> {
  _buffer = [..._buffer, msg];
  if (!_userId) return;
  const { error } = await supabase.from("mavis_memory").insert({
    user_id: _userId,
    session_id: _sessionId,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
  });
  if (error) console.warn("[Memory L2] Failed to persist:", error.message);
}

export async function loadSession(sessionId: string): Promise<MavisMessage[]> {
  try {
    const { data } = await supabase
      .from("mavis_memory")
      .select("*")
      .eq("user_id", _userId)
      .eq("session_id", sessionId)
      .order("timestamp", { ascending: true });
    return (data ?? []).map(r => ({
      id: r.id, role: r.role as MavisMessage["role"],
      content: r.content, timestamp: r.timestamp,
    }));
  } catch { return []; }
}

export async function loadRecentMemory(limit = 50): Promise<MavisMessage[]> {
  try {
    const { data } = await supabase
      .from("mavis_memory")
      .select("*")
      .eq("user_id", _userId)
      .order("timestamp", { ascending: false })
      .limit(limit);
    return (data ?? []).reverse().map(r => ({
      id: r.id, role: r.role as MavisMessage["role"],
      content: r.content, timestamp: r.timestamp,
    }));
  } catch { return []; }
}

export async function listSessions(): Promise<{ sessionId: string; preview: string; timestamp: number }[]> {
  try {
    const { data } = await supabase
      .from("mavis_memory")
      .select("session_id, content, timestamp")
      .eq("user_id", _userId)
      .order("timestamp", { ascending: false });
    const seen = new Map<string, { sessionId: string; preview: string; timestamp: number }>();
    for (const row of data ?? []) {
      if (!seen.has(row.session_id)) {
        seen.set(row.session_id, {
          sessionId: row.session_id,
          preview: row.content.slice(0, 100),
          timestamp: row.timestamp,
        });
      }
    }
    return [...seen.values()];
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────
// LAYER 1 — KNOWLEDGE GRAPH (PARA)
// ─────────────────────────────────────────────────────────────

export type KnowledgeCategory = "project" | "area" | "resource" | "archive";

export interface KnowledgeEntry {
  id?: string;
  category: KnowledgeCategory;
  title: string;
  content: string;
  tags?: string[];
  relatedIds?: string[];
}

export async function saveKnowledge(entry: KnowledgeEntry): Promise<string | null> {
  if (!_userId) return null;
  try {
    const { data, error } = await supabase
      .from("mavis_knowledge")
      .upsert({
        user_id: _userId,
        category: entry.category,
        title: entry.title,
        content: entry.content,
        tags: entry.tags ?? [],
        related_ids: entry.relatedIds ?? [],
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,title" })
      .select("id")
      .single();
    if (error || !data) return null;
    return (data as any).id;
  } catch { return null; }
}

export async function getKnowledge(category?: KnowledgeCategory, limit = 20): Promise<KnowledgeEntry[]> {
  if (!_userId) return [];
  try {
    let q = supabase.from("mavis_knowledge").select("*").eq("user_id", _userId);
    if (category) q = (q as any).eq("category", category);
    const { data } = await (q as any).order("last_referenced", { ascending: false }).limit(limit);
    return (data ?? []).map((r: any) => ({
      id: r.id, category: r.category, title: r.title,
      content: r.content, tags: r.tags, relatedIds: r.related_ids,
    }));
  } catch { return []; }
}

export async function searchKnowledge(query: string): Promise<KnowledgeEntry[]> {
  if (!_userId) return [];
  try {
    const { data } = await supabase
      .from("mavis_knowledge")
      .select("*")
      .eq("user_id", _userId)
      .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
      .limit(10);
    return (data ?? []).map((r: any) => ({
      id: r.id, category: r.category, title: r.title,
      content: r.content, tags: r.tags,
    }));
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────
// LAYER 3 — TACIT KNOWLEDGE
// ─────────────────────────────────────────────────────────────

export type TacitCategory =
  | "preference" | "hard_rule" | "lesson_learned"
  | "workflow_habit" | "communication_style" | "standing_order";

export interface TacitEntry {
  category: TacitCategory;
  key: string;
  value: string;
  source?: string;
  confidence?: number;
}

export async function saveTacit(entry: TacitEntry): Promise<void> {
  if (!_userId) return;
  const { error } = await supabase.from("mavis_tacit").upsert({
    user_id: _userId,
    category: entry.category,
    key: entry.key,
    value: entry.value,
    source: entry.source,
    confidence: entry.confidence ?? 5,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,key" });
  if (error) console.warn("[Memory L3] Failed to save tacit:", error.message);
}

export async function getTacit(category?: TacitCategory): Promise<TacitEntry[]> {
  if (!_userId) return [];
  try {
    let q = supabase.from("mavis_tacit").select("*").eq("user_id", _userId);
    if (category) q = (q as any).eq("category", category);
    const { data } = await (q as any).order("confidence", { ascending: false });
    return (data ?? []).map((r: any) => ({
      category: r.category, key: r.key, value: r.value,
      source: r.source, confidence: r.confidence,
    }));
  } catch { return []; }
}

export async function getAllTacit(): Promise<TacitEntry[]> {
  return getTacit();
}

// ─────────────────────────────────────────────────────────────
// FULL MEMORY CONTEXT BUILDER
// Injects all three layers into the system prompt
// ─────────────────────────────────────────────────────────────

export async function buildMemoryContext(): Promise<string> {
  if (!_userId) return "";

  const [projects, areas, resources, tacitAll, recentMessages] = await Promise.all([
    getKnowledge("project"),
    getKnowledge("area"),
    getKnowledge("resource"),
    getAllTacit(),
    loadRecentMemory(20),
  ]);

  const sections: string[] = [];

  if (projects.length > 0) {
    sections.push(`[LAYER 1 — ACTIVE PROJECTS]\n${projects.map(p => `• ${p.title}: ${p.content.slice(0, 200)}`).join("\n")}`);
  }
  if (areas.length > 0) {
    sections.push(`[LAYER 1 — AREAS OF RESPONSIBILITY]\n${areas.map(a => `• ${a.title}: ${a.content.slice(0, 150)}`).join("\n")}`);
  }
  if (resources.length > 0) {
    sections.push(`[LAYER 1 — RESOURCES]\n${resources.map(r => `• ${r.title}: ${r.content.slice(0, 100)}`).join("\n")}`);
  }

  const hardRules = tacitAll.filter(t => t.category === "hard_rule");
  const preferences = tacitAll.filter(t => t.category === "preference" || t.category === "communication_style");
  const lessons = tacitAll.filter(t => t.category === "lesson_learned");
  const habits = tacitAll.filter(t => t.category === "workflow_habit");

  if (hardRules.length > 0) {
    sections.push(`[LAYER 3 — HARD RULES (never violate)]\n${hardRules.map(r => `• ${r.key}: ${r.value}`).join("\n")}`);
  }
  if (preferences.length > 0) {
    sections.push(`[LAYER 3 — OPERATOR PREFERENCES]\n${preferences.map(p => `• ${p.key}: ${p.value}`).join("\n")}`);
  }
  if (lessons.length > 0) {
    sections.push(`[LAYER 3 — LESSONS LEARNED]\n${lessons.map(l => `• ${l.key}: ${l.value}`).join("\n")}`);
  }
  if (habits.length > 0) {
    sections.push(`[LAYER 3 — WORKFLOW HABITS]\n${habits.map(h => `• ${h.key}: ${h.value}`).join("\n")}`);
  }

  if (recentMessages.length > 0) {
    const summary = recentMessages.slice(-5).map(m => `[${m.role}]: ${m.content.slice(0, 100)}`).join("\n");
    sections.push(`[LAYER 2 — RECENT CROSS-SESSION CONTEXT]\n${summary}`);
  }

  return sections.join("\n\n");
}
