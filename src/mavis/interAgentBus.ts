/**
 * Inter-Agent Message Bus — Moltbook A2A Protocol adapter.
 * Agents publish/receive typed message envelopes via the mavis_agent_messages table.
 * Supabase Realtime delivers messages without polling. Fallback polling included.
 */

import { supabase } from "@/integrations/supabase/client";
import { RealtimeChannel } from "@supabase/supabase-js";

// ── Message types ────────────────────────────────────────────────────────────

export type MessageIntent =
  | "REQUEST"
  | "RESPONSE"
  | "BROADCAST"
  | "HEARTBEAT"
  | "SIGNAL"
  | "VOTE"
  | "DELEGATE";

export type MessagePriority = "critical" | "high" | "normal" | "background";

export interface AgentAddress {
  id: string;    // e.g. "council/abc", "persona/xyz", "plugin/trader", "mavis"
  name: string;
  type: "council" | "persona" | "plugin" | "mavis";
  karma?: number;
}

export interface A2AMessage {
  id: string;
  userId: string;
  from: AgentAddress;
  to: { id: string; name?: string };
  intent: MessageIntent;
  content: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  priority: MessagePriority;
  ttlMs: number;
  delivered: boolean;
  read: boolean;
  ack: boolean;
  createdAt: string;
  expiresAt?: string;
}

export type MessageHandler = (msg: A2AMessage) => Promise<void>;

// ── Karma ledger (in-memory cache; DB is source of truth) ───────────────────

const karmaCache = new Map<string, number>();

// ── Agent Inbox ───────────────────────────────────────────────────────────────

class AgentInbox {
  private handlers = new Map<string, MessageHandler[]>();
  private channels = new Map<string, RealtimeChannel>();
  private pollIntervals = new Map<string, ReturnType<typeof setInterval>>();

  /** Subscribe an agent to incoming messages. Uses Realtime; falls back to poll. */
  subscribe(agentId: string, userId: string, handler: MessageHandler): () => void {
    const existing = this.handlers.get(agentId) ?? [];
    this.handlers.set(agentId, [...existing, handler]);

    if (!this.channels.has(agentId)) {
      this._openRealtimeChannel(agentId, userId);
    }

    return () => this._removeHandler(agentId, handler);
  }

  private _openRealtimeChannel(agentId: string, userId: string): void {
    const channel = supabase
      .channel(`a2a:${agentId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "mavis_agent_messages",
          filter: `to_agent_id=eq.${agentId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          this._dispatch(agentId, this._rowToMessage(row));
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          this._startPolling(agentId, userId);
        }
      });

    this.channels.set(agentId, channel);
  }

  private _startPolling(agentId: string, userId: string): void {
    if (this.pollIntervals.has(agentId)) return;
    let lastChecked = new Date().toISOString();

    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("mavis_agent_messages")
        .select("*")
        .eq("to_agent_id", agentId)
        .eq("user_id", userId)
        .eq("delivered", false)
        .gt("created_at", lastChecked)
        .order("created_at", { ascending: true });

      lastChecked = new Date().toISOString();
      (data ?? []).forEach(row => this._dispatch(agentId, this._rowToMessage(row)));
    }, 10_000);

    this.pollIntervals.set(agentId, interval);
  }

  private async _dispatch(agentId: string, msg: A2AMessage): Promise<void> {
    const handlers = this.handlers.get(agentId) ?? [];
    for (const h of handlers) {
      try { await h(msg); } catch {/* handler errors are isolated */}
    }
    // Mark delivered
    await supabase
      .from("mavis_agent_messages")
      .update({ delivered: true })
      .eq("id", msg.id)
      .catch(() => {/* non-fatal */});
  }

  private _removeHandler(agentId: string, handler: MessageHandler): void {
    const updated = (this.handlers.get(agentId) ?? []).filter(h => h !== handler);
    if (updated.length === 0) {
      this.handlers.delete(agentId);
      const ch = this.channels.get(agentId);
      if (ch) { supabase.removeChannel(ch); this.channels.delete(agentId); }
      const interval = this.pollIntervals.get(agentId);
      if (interval) { clearInterval(interval); this.pollIntervals.delete(agentId); }
    } else {
      this.handlers.set(agentId, updated);
    }
  }

  private _rowToMessage(row: Record<string, unknown>): A2AMessage {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      from: {
        id: row.from_agent_id as string,
        name: row.from_agent_name as string,
        type: row.from_agent_type as AgentAddress["type"],
        karma: (row.from_karma as number) ?? 0,
      },
      to: { id: row.to_agent_id as string, name: row.to_agent_name as string | undefined },
      intent: row.intent as MessageIntent,
      content: row.content as string,
      payload: (row.payload as Record<string, unknown>) ?? {},
      correlationId: row.correlation_id as string | undefined,
      priority: (row.priority as MessagePriority) ?? "normal",
      ttlMs: (row.ttl_ms as number) ?? 300_000,
      delivered: Boolean(row.delivered),
      read: Boolean(row.read),
      ack: Boolean(row.ack),
      createdAt: row.created_at as string,
      expiresAt: row.expires_at as string | undefined,
    };
  }

  /** Fetch unread messages for an agent (catch-up on startup). */
  async fetchPending(agentId: string, userId: string): Promise<A2AMessage[]> {
    const { data } = await supabase
      .from("mavis_agent_messages")
      .select("*")
      .eq("to_agent_id", agentId)
      .eq("user_id", userId)
      .eq("delivered", false)
      .order("created_at", { ascending: true });

    return (data ?? []).map(row => this._rowToMessage(row));
  }
}

export const agentInbox = new AgentInbox();

// ── Message sending ───────────────────────────────────────────────────────────

export async function sendMessage(
  from: AgentAddress,
  toId: string,
  intent: MessageIntent,
  content: string,
  options?: {
    toName?: string;
    payload?: Record<string, unknown>;
    correlationId?: string;
    priority?: MessagePriority;
    ttlMs?: number;
  }
): Promise<string | null> {
  const karma = karmaCache.get(from.id) ?? 0;
  const { data, error } = await supabase
    .from("mavis_agent_messages")
    .insert({
      user_id: await _currentUserId(),
      from_agent_id: from.id,
      from_agent_name: from.name,
      from_agent_type: from.type,
      from_karma: karma,
      to_agent_id: toId,
      to_agent_name: options?.toName ?? null,
      intent,
      content,
      payload: options?.payload ?? {},
      correlation_id: options?.correlationId ?? null,
      priority: options?.priority ?? "normal",
      ttl_ms: options?.ttlMs ?? 300_000,
    })
    .select("id")
    .single();

  if (error) return null;
  return data.id as string;
}

export async function broadcastToAll(
  from: AgentAddress,
  intent: MessageIntent,
  content: string,
  payload?: Record<string, unknown>
): Promise<void> {
  // Fan-out to a special broadcast channel all agents monitor
  await sendMessage(from, "broadcast", intent, content, {
    toName: "ALL_AGENTS",
    payload: payload ?? {},
    priority: "normal",
  });
}

export async function replyTo(
  correlationId: string,
  from: AgentAddress,
  content: string,
  payload?: Record<string, unknown>
): Promise<void> {
  // Look up the original message to find the requester
  const { data } = await supabase
    .from("mavis_agent_messages")
    .select("from_agent_id, from_agent_name, user_id")
    .eq("id", correlationId)
    .single();

  if (!data) return;

  await sendMessage(from, data.from_agent_id, "RESPONSE", content, {
    toName: data.from_agent_name,
    payload: payload ?? {},
    correlationId,
    priority: "high",
  });
}

// ── Heartbeat (Moltbook 4-hour cycle) ────────────────────────────────────────

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export function startHeartbeat(agent: AgentAddress, onBeat?: () => Promise<void>): void {
  if (heartbeatTimer) return;
  const FOUR_HOURS = 4 * 60 * 60 * 1000;

  const beat = async () => {
    await broadcastToAll(agent, "HEARTBEAT", `${agent.name} heartbeat`, {
      timestamp: Date.now(),
      agentId: agent.id,
    });
    if (onBeat) await onBeat().catch(() => {/* non-fatal */});
  };

  beat(); // immediate first beat
  heartbeatTimer = setInterval(beat, FOUR_HOURS);
}

export function stopHeartbeat(): void {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

// ── Karma management ──────────────────────────────────────────────────────────

export async function updateKarma(agentId: string, delta: number): Promise<void> {
  const userId = await _currentUserId();
  if (!userId) return;

  const { data } = await supabase
    .from("mavis_agent_karma")
    .select("karma")
    .eq("agent_id", agentId)
    .eq("user_id", userId)
    .maybeSingle();

  const newKarma = (data?.karma ?? 0) + delta;
  karmaCache.set(agentId, newKarma);

  await supabase.from("mavis_agent_karma").upsert({
    user_id: userId,
    agent_id: agentId,
    karma: newKarma,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,agent_id" }).catch(() => {/* non-fatal */});
}

export async function getKarma(agentId: string): Promise<number> {
  if (karmaCache.has(agentId)) return karmaCache.get(agentId)!;
  const userId = await _currentUserId();
  const { data } = await supabase
    .from("mavis_agent_karma")
    .select("karma")
    .eq("agent_id", agentId)
    .eq("user_id", userId)
    .maybeSingle();
  const k = data?.karma ?? 0;
  karmaCache.set(agentId, k);
  return k;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function _currentUserId(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user.id ?? "";
}
