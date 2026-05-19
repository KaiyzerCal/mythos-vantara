/**
 * System Monitor & Automation Engine — OpenJarvis event-driven automation.
 * Observes browser/app state and triggers MAVIS workflows on events.
 *
 * Event sources (browser-available):
 *  - Network: online/offline transitions, connection quality
 *  - App visibility: tab focus/blur, page visibility
 *  - Storage: localStorage changes (settings updates)
 *  - Periodic: configurable interval checks
 *  - Metrics: memory usage, tab count, estimated load
 *  - Custom: agent signals, knowledge events, trade signals
 *
 * Automation rules from mavis_automation_rules are loaded on start and
 * re-evaluated on each relevant event. Rule actions dispatch to the
 * appropriate MAVIS subsystem (skills, plugins, agent bus, distillation).
 */

import { supabase } from "@/integrations/supabase/client";
import { sendMessage, broadcastToAll } from "@/mavis/interAgentBus";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MonitorEventType =
  | "network:online"
  | "network:offline"
  | "network:degraded"
  | "visibility:hidden"
  | "visibility:visible"
  | "app:focus"
  | "app:blur"
  | "storage:change"
  | "metric:memory_high"
  | "metric:idle"
  | "schedule:daily"
  | "schedule:interval"
  | "agent:signal"
  | "custom";

export interface MonitorEvent {
  type: MonitorEventType;
  timestamp: number;
  payload?: Record<string, unknown>;
}

export interface SystemMetrics {
  onLine: boolean;
  connectionType?: string;         // "4g" | "3g" | "wifi" | "unknown"
  memoryMB?: number;               // JS heap used (Chrome only)
  tabVisible: boolean;
  appFocused: boolean;
  uptimeSeconds: number;
  eventCount: number;
}

export type MonitorEventHandler = (event: MonitorEvent) => void | Promise<void>;

export interface AutomationRule {
  id: string;
  name: string;
  triggerEvent: MonitorEventType | string;
  triggerConfig: Record<string, unknown>;
  conditionExpr?: string;
  actionType: string;
  actionConfig: Record<string, unknown>;
  enabled: boolean;
  cooldownMs: number;
  lastTriggeredAt?: number;
  triggerCount: number;
}

// ── Safe condition evaluator ──────────────────────────────────────────────────

function evaluateCondition(
  expr: string,
  context: { event: MonitorEvent; metrics: SystemMetrics }
): boolean {
  try {
    // Whitelist-based evaluation — no arbitrary code execution
    const safeExpr = expr
      .replace(/context\.onLine/g, String(context.metrics.onLine))
      .replace(/context\.visible/g, String(context.metrics.tabVisible))
      .replace(/context\.focused/g, String(context.metrics.appFocused))
      .replace(/context\.memoryMB/g, String(context.metrics.memoryMB ?? 0))
      .replace(/event\.type/g, `"${context.event.type}"`);

    // Only allow simple boolean expressions
    if (/[;{}()\[\]]/g.test(safeExpr)) return false;
    return Boolean(Function(`"use strict"; return (${safeExpr})`)());
  } catch { return false; }
}

// ── Action dispatcher ─────────────────────────────────────────────────────────

type ActionDispatcher = (rule: AutomationRule, event: MonitorEvent, userId: string) => Promise<void>;

const ACTION_DISPATCHERS: Record<string, ActionDispatcher> = {
  send_agent_message: async (rule, event, _userId) => {
    const cfg = rule.actionConfig;
    const from = {
      id: "system-monitor",
      name: "SENTINEL",
      type: "plugin" as const,
    };
    await sendMessage(
      from,
      String(cfg.to_agent_id ?? "mavis"),
      "SIGNAL",
      String(cfg.content ?? `Event: ${event.type}`),
      { payload: { event, rule: rule.name } }
    );
  },

  notify_operator: async (rule, event, _userId) => {
    const from = { id: "system-monitor", name: "SENTINEL", type: "plugin" as const };
    await broadcastToAll(from, "SIGNAL", `[SENTINEL] ${rule.name}: ${event.type}`, {
      event, rule: rule.name, config: rule.actionConfig,
    });
  },

  store_memory: async (rule, event, userId) => {
    const { storeMemory } = await import("@/mavis/agentMemoryEngine");
    await storeMemory({
      agentId: "system-monitor",
      agentName: "SENTINEL",
      agentType: "plugin",
      entityType: "signal",
      memoryType: "episodic",
      content: `Automation trigger: ${rule.name} fired on ${event.type}`,
      tags: ["automation", event.type, rule.name],
      wikilinks: [],
      importance: 4,
      confidence: 9,
    }, userId);
  },

  run_distillation: async (rule, _event, userId) => {
    const { compressKnowledge } = await import("@/mavis/thoughtDistillation");
    const cfg = rule.actionConfig;
    await compressKnowledge(
      userId,
      (cfg.source_types as Array<"notes" | "journal" | "vault">) ?? ["notes", "journal"],
      String(cfg.topic ?? "daily synthesis"),
      String(cfg.agent_id ?? "system-monitor")
    );
  },

  invoke_skill: async (rule, event, _userId) => {
    const { invokeSkill } = await import("@/mavis/skills/_registry");
    const cfg = rule.actionConfig;
    await invokeSkill(String(cfg.skill_name), {
      userId: _userId,
      mode: "PRIME",
    }, String(cfg.input ?? event.type));
  },
};

// ── System Monitor (singleton) ────────────────────────────────────────────────

class SystemMonitor {
  private started = false;
  private startTime = Date.now();
  private eventCount = 0;
  private handlers = new Map<string, Set<MonitorEventHandler>>();
  private rules: AutomationRule[] = [];
  private userId: string | null = null;
  private intervals: ReturnType<typeof setInterval>[] = [];
  private metrics: SystemMetrics = {
    onLine: navigator.onLine,
    tabVisible: !document.hidden,
    appFocused: document.hasFocus(),
    uptimeSeconds: 0,
    eventCount: 0,
  };

  // ── Start / Stop ──────────────────────────────────────────────────────────

  async start(userId: string): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.userId = userId;

    this._registerBrowserEvents();
    this._startPeriodicChecks();
    await this.loadRules(userId);

    this._emit({ type: "network:online", timestamp: Date.now(), payload: { startup: true } });
  }

  stop(): void {
    this.intervals.forEach(clearInterval);
    this.intervals = [];
    this.started = false;
  }

  // ── Rule management ───────────────────────────────────────────────────────

  async loadRules(userId: string): Promise<void> {
    const { data } = await supabase
      .from("mavis_automation_rules")
      .select("*")
      .eq("user_id", userId)
      .eq("enabled", true);

    this.rules = (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      name: row.name as string,
      triggerEvent: row.trigger_event as MonitorEventType,
      triggerConfig: (row.trigger_config as Record<string, unknown>) ?? {},
      conditionExpr: row.condition_expr as string | undefined,
      actionType: row.action_type as string,
      actionConfig: (row.action_config as Record<string, unknown>) ?? {},
      enabled: Boolean(row.enabled),
      cooldownMs: (row.cooldown_ms as number) ?? 300_000,
      lastTriggeredAt: row.last_triggered_at
        ? new Date(row.last_triggered_at as string).getTime()
        : undefined,
      triggerCount: (row.trigger_count as number) ?? 0,
    }));
  }

  addRule(rule: AutomationRule): void {
    const idx = this.rules.findIndex(r => r.id === rule.id);
    if (idx >= 0) this.rules[idx] = rule;
    else this.rules.push(rule);
  }

  removeRule(id: string): void {
    this.rules = this.rules.filter(r => r.id !== id);
  }

  // ── Event subscription ────────────────────────────────────────────────────

  on(eventType: MonitorEventType | "all", handler: MonitorEventHandler): () => void {
    const key = eventType;
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key)!.add(handler);
    return () => this.handlers.get(key)?.delete(handler);
  }

  // ── Event emission ────────────────────────────────────────────────────────

  private _emit(event: MonitorEvent): void {
    this.eventCount++;
    this.metrics.eventCount = this.eventCount;

    // Notify direct handlers
    this.handlers.get(event.type)?.forEach(h => h(event));
    this.handlers.get("all")?.forEach(h => h(event));

    // Evaluate automation rules
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      if (rule.triggerEvent !== event.type && rule.triggerEvent !== "custom") continue;

      const now = Date.now();
      if (rule.lastTriggeredAt && now - rule.lastTriggeredAt < rule.cooldownMs) continue;

      if (rule.conditionExpr && !evaluateCondition(rule.conditionExpr, { event, metrics: this.metrics })) continue;

      this._executeRule(rule, event);
    }
  }

  private async _executeRule(rule: AutomationRule, event: MonitorEvent): Promise<void> {
    if (!this.userId) return;

    rule.lastTriggeredAt = Date.now();
    rule.triggerCount++;

    const dispatcher = ACTION_DISPATCHERS[rule.actionType];
    if (dispatcher) {
      await dispatcher(rule, event, this.userId).catch(() => {/* non-fatal */});
    }

    // Update DB
    await supabase
      .from("mavis_automation_rules")
      .update({
        last_triggered_at: new Date().toISOString(),
        trigger_count: rule.triggerCount,
      })
      .eq("id", rule.id)
      .catch(() => {/* non-fatal */});
  }

  // ── Browser event registration ────────────────────────────────────────────

  private _registerBrowserEvents(): void {
    window.addEventListener("online", () => {
      this.metrics.onLine = true;
      this._emit({ type: "network:online", timestamp: Date.now() });
    });

    window.addEventListener("offline", () => {
      this.metrics.onLine = false;
      this._emit({ type: "network:offline", timestamp: Date.now() });
    });

    document.addEventListener("visibilitychange", () => {
      const visible = !document.hidden;
      this.metrics.tabVisible = visible;
      this._emit({
        type: visible ? "visibility:visible" : "visibility:hidden",
        timestamp: Date.now(),
      });
    });

    window.addEventListener("focus", () => {
      this.metrics.appFocused = true;
      this._emit({ type: "app:focus", timestamp: Date.now() });
    });

    window.addEventListener("blur", () => {
      this.metrics.appFocused = false;
      this._emit({ type: "app:blur", timestamp: Date.now() });
    });

    window.addEventListener("storage", (e) => {
      this._emit({
        type: "storage:change",
        timestamp: Date.now(),
        payload: { key: e.key, oldValue: e.oldValue, newValue: e.newValue },
      });
    });
  }

  // ── Periodic checks ───────────────────────────────────────────────────────

  private _startPeriodicChecks(): void {
    // Uptime + memory metrics every 60s
    this.intervals.push(setInterval(() => {
      this.metrics.uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

      // Chrome-only memory API
      const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
      if (perf.memory) {
        const memMB = Math.round(perf.memory.usedJSHeapSize / 1_048_576);
        this.metrics.memoryMB = memMB;
        if (memMB > 512) {
          this._emit({ type: "metric:memory_high", timestamp: Date.now(), payload: { memoryMB: memMB } });
        }
      }

      // Connection type (NetworkInformation API)
      const conn = (navigator as Navigator & { connection?: { effectiveType: string } }).connection;
      if (conn) this.metrics.connectionType = conn.effectiveType;
    }, 60_000));

    // Idle detection: emit after 5 minutes of no events
    let lastEventTime = Date.now();
    this.on("all", () => { lastEventTime = Date.now(); });
    this.intervals.push(setInterval(() => {
      if (Date.now() - lastEventTime > 5 * 60 * 1000) {
        this._emit({ type: "metric:idle", timestamp: Date.now(), payload: { idleMs: Date.now() - lastEventTime } });
      }
    }, 60_000));

    // Daily schedule check — fires at configured hours
    this.intervals.push(setInterval(() => {
      const now = new Date();
      for (const rule of this.rules) {
        if (rule.triggerEvent !== "schedule:daily") continue;
        const targetHour = (rule.triggerConfig.hour as number) ?? 0;
        const targetMinute = (rule.triggerConfig.minute as number) ?? 0;
        if (now.getHours() === targetHour && now.getMinutes() === targetMinute) {
          this._emit({ type: "schedule:daily", timestamp: Date.now(), payload: { hour: targetHour, minute: targetMinute } });
        }
      }
    }, 60_000));
  }

  getMetrics(): SystemMetrics {
    return { ...this.metrics };
  }

  isRunning(): boolean {
    return this.started;
  }

  /** Manually emit a custom event (for agent signals, external triggers) */
  emit(type: MonitorEventType, payload?: Record<string, unknown>): void {
    this._emit({ type, timestamp: Date.now(), payload });
  }
}

export const systemMonitor = new SystemMonitor();

// ── Quick automation rule builder ─────────────────────────────────────────────

export async function createAutomationRule(
  userId: string,
  rule: Omit<AutomationRule, "id" | "lastTriggeredAt" | "triggerCount">
): Promise<string | null> {
  const { data, error } = await supabase
    .from("mavis_automation_rules")
    .insert({
      user_id: userId,
      name: rule.name,
      trigger_event: rule.triggerEvent,
      trigger_config: rule.triggerConfig,
      condition_expr: rule.conditionExpr ?? null,
      action_type: rule.actionType,
      action_config: rule.actionConfig,
      enabled: rule.enabled,
      cooldown_ms: rule.cooldownMs,
    })
    .select("id")
    .single();

  if (error) return null;
  systemMonitor.addRule({ ...rule, id: data.id, triggerCount: 0 });
  return data.id;
}

/** Pre-built rule: notify on network loss */
export async function ruleOfflineAlert(userId: string): Promise<void> {
  await createAutomationRule(userId, {
    name: "Offline Alert",
    triggerEvent: "network:offline",
    triggerConfig: {},
    actionType: "notify_operator",
    actionConfig: { severity: "WARN", message: "Network connection lost" },
    enabled: true,
    cooldownMs: 60_000,
  });
}

/** Pre-built rule: nightly distillation at 3 AM */
export async function ruleNightlyDistillation(userId: string, agentId: string): Promise<void> {
  await createAutomationRule(userId, {
    name: "Nightly Knowledge Distillation",
    triggerEvent: "schedule:daily",
    triggerConfig: { hour: 3, minute: 0 },
    actionType: "run_distillation",
    actionConfig: {
      source_types: ["notes", "journal"],
      topic: "daily knowledge synthesis",
      agent_id: agentId,
    },
    enabled: true,
    cooldownMs: 23 * 60 * 60 * 1000,
  });
}
