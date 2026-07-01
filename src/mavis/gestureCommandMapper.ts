/**
 * Gesture Command Mapper — Maps MediaPipe / TouchDesigner gesture detections
 * to MAVIS actions, skills, and system commands.
 *
 * Debouncing: each gesture must be held for `holdMs` (default 0 = single
 * detection) to prevent false triggers. A 2-second cooldown between same-gesture
 * firings prevents rapid repetition.
 *
 * Default mappings (all overridable):
 *   Open_Palm      → pause/resume voice overlay
 *   Thumb_Up       → approve latest pending workspace op
 *   Closed_Fist    → dismiss/stop current action
 *   Victory        → cycle to next council member or persona
 *   Pointing_Up    → summon MAVIS prime mode
 *   Thumb_Down     → deny latest pending workspace op
 *   ILoveYou       → trigger calm/meditation skill
 *
 * Custom mappings are persisted to mavis_gesture_commands DB table and
 * loaded on start via `loadUserMappings()`.
 */

import { supabase as _sb } from "@/integrations/supabase/client";
const supabase: any = _sb;
import { systemMonitor } from "@/mavis/systemMonitor";
import { touchDesignerBridge } from "@/mavis/touchDesignerBridge";
import type { GestureName } from "@/mavis/mediaPipeEngine";

// ── Types ─────────────────────────────────────────────────────────────────────

export type GestureAction =
  | "voice:toggle"           // pause/resume voice overlay
  | "voice:stop"             // stop speaking immediately
  | "approve:pending_op"     // approve top pending workspace op
  | "deny:pending_op"        // deny top pending workspace op
  | "persona:cycle_next"     // cycle to next council member/persona
  | "persona:cycle_prev"     // cycle to previous
  | "mavis:summon"           // bring up MAVIS prime
  | "skill:run"              // run a named skill (payload.skill)
  | "workflow:run"           // run a workflow (payload.workflow, payload.input)
  | "notify:operator"        // push a notification
  | "custom";                // arbitrary (payload.handler)

export interface GestureCommand {
  gesture: GestureName | string;
  action: GestureAction;
  label: string;
  holdMs: number;            // 0 = instant, 500+ = hold required
  payload?: Record<string, unknown>;
  enabled: boolean;
}

// ── Default mappings ──────────────────────────────────────────────────────────

const DEFAULT_COMMANDS: GestureCommand[] = [
  {
    gesture: "Open_Palm",
    action: "voice:toggle",
    label: "Open palm — Toggle voice overlay",
    holdMs: 500,
    enabled: true,
  },
  {
    gesture: "Thumb_Up",
    action: "approve:pending_op",
    label: "Thumbs up — Approve pending operation",
    holdMs: 300,
    enabled: true,
  },
  {
    gesture: "Thumb_Down",
    action: "deny:pending_op",
    label: "Thumbs down — Deny pending operation",
    holdMs: 300,
    enabled: true,
  },
  {
    gesture: "Closed_Fist",
    action: "voice:stop",
    label: "Closed fist — Stop voice immediately",
    holdMs: 0,
    enabled: true,
  },
  {
    gesture: "Victory",
    action: "persona:cycle_next",
    label: "Peace sign — Cycle to next persona/council member",
    holdMs: 400,
    enabled: true,
  },
  {
    gesture: "Pointing_Up",
    action: "mavis:summon",
    label: "Pointing up — Summon MAVIS",
    holdMs: 600,
    enabled: true,
  },
  {
    gesture: "ILoveYou",
    action: "skill:run",
    label: "ILY — Run calm/meditation skill",
    holdMs: 800,
    payload: { skill: "calm", input: "Guide me through a brief calming moment." },
    enabled: true,
  },
];

// ── Action handlers ───────────────────────────────────────────────────────────

type ActionHandler = (cmd: GestureCommand) => Promise<void>;

const ACTION_HANDLERS: Partial<Record<GestureAction, ActionHandler>> = {
  "voice:toggle": async () => {
    systemMonitor.emit("gesture:action", { action: "voice:toggle" });
  },
  "voice:stop": async () => {
    systemMonitor.emit("gesture:action", { action: "voice:stop" });
  },
  "approve:pending_op": async () => {
    systemMonitor.emit("gesture:action", { action: "approve:pending_op" });
  },
  "deny:pending_op": async () => {
    systemMonitor.emit("gesture:action", { action: "deny:pending_op" });
  },
  "persona:cycle_next": async () => {
    systemMonitor.emit("gesture:action", { action: "persona:cycle_next" });
  },
  "persona:cycle_prev": async () => {
    systemMonitor.emit("gesture:action", { action: "persona:cycle_prev" });
  },
  "mavis:summon": async () => {
    systemMonitor.emit("gesture:action", { action: "mavis:summon" });
  },
  "skill:run": async (cmd) => {
    systemMonitor.emit("gesture:action", {
      action: "skill:run",
      skill: cmd.payload?.skill,
      input: cmd.payload?.input ?? "",
    });
  },
  "workflow:run": async (cmd) => {
    systemMonitor.emit("gesture:action", {
      action: "workflow:run",
      workflow: cmd.payload?.workflow,
      input: cmd.payload?.input ?? "",
    });
  },
};

// ── GestureCommandMapper ──────────────────────────────────────────────────────

class GestureCommandMapper {
  private _commands: Map<string, GestureCommand> = new Map();
  private _holdTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private _lastFiredAt: Map<string, number> = new Map();
  private _userId: string | null = null;
  private _cooldownMs = 2000; // same gesture won't fire twice within 2s

  constructor() {
    for (const cmd of DEFAULT_COMMANDS) {
      this._commands.set(cmd.gesture, cmd);
    }
  }

  /** Load user's custom mappings from DB, overlaying defaults */
  async loadUserMappings(userId: string): Promise<void> {
    this._userId = userId;
    const { data } = await supabase
      .from("mavis_gesture_commands")
      .select("*")
      .eq("user_id", userId)
      .eq("enabled", true)
      .catch(() => ({ data: null }));

    if (!data) return;
    for (const row of data) {
      this._commands.set(row.gesture as string, {
        gesture: row.gesture as GestureName,
        action: row.action as GestureAction,
        label: (row.description as string) ?? row.action as string,
        holdMs: (row.hold_ms as number) ?? 0,
        payload: (row.action_payload as Record<string, unknown>) ?? {},
        enabled: Boolean(row.enabled),
      });
    }
  }

  /** Called on each gesture detection event */
  async onGesture(
    gesture: GestureName | string,
    confidence: number,
    source: "mediapipe" | "touchdesigner" | "osc" = "mediapipe"
  ): Promise<void> {
    if (confidence < 0.75) return; // reject low-confidence detections

    const cmd = this._commands.get(gesture);
    if (!cmd?.enabled) return;

    // Enforce cooldown
    const lastFired = this._lastFiredAt.get(gesture) ?? 0;
    if (Date.now() - lastFired < this._cooldownMs) return;

    if (cmd.holdMs <= 0) {
      // Instant trigger
      await this._fire(cmd, source);
    } else {
      // Hold timer — cancel any existing timer for this gesture
      const existing = this._holdTimers.get(gesture);
      if (existing) return; // already holding, wait for it

      const timer = setTimeout(async () => {
        this._holdTimers.delete(gesture);
        await this._fire(cmd, source);
      }, cmd.holdMs);

      this._holdTimers.set(gesture, timer);
    }
  }

  /** Cancel hold timer when gesture disappears before hold time */
  onGestureEnd(gesture: GestureName | string): void {
    const timer = this._holdTimers.get(gesture);
    if (timer) {
      clearTimeout(timer);
      this._holdTimers.delete(gesture);
    }
  }

  /** Add or update a command mapping */
  setCommand(cmd: GestureCommand): void {
    this._commands.set(cmd.gesture, cmd);
  }

  /** Remove a mapping */
  removeCommand(gesture: string): void {
    this._commands.delete(gesture);
    const timer = this._holdTimers.get(gesture);
    if (timer) { clearTimeout(timer); this._holdTimers.delete(gesture); }
  }

  /** Persist a mapping to DB */
  async saveCommand(cmd: GestureCommand): Promise<void> {
    if (!this._userId) return;
    await supabase.from("mavis_gesture_commands").upsert({
      user_id: this._userId,
      gesture: cmd.gesture,
      hold_ms: cmd.holdMs,
      action: cmd.action,
      action_payload: cmd.payload ?? {},
      description: cmd.label,
      enabled: cmd.enabled,
    }, { onConflict: "user_id,gesture" }).catch(() => {/* non-fatal */});
    this.setCommand(cmd);
  }

  /** List all current mappings */
  listCommands(): GestureCommand[] {
    return [...this._commands.values()];
  }

  private async _fire(cmd: GestureCommand, source: string): Promise<void> {
    this._lastFiredAt.set(cmd.gesture, Date.now());

    const handler = ACTION_HANDLERS[cmd.action];
    if (handler) {
      try { await handler(cmd); } catch (err) {
        console.error("[GestureMapper] Action handler failed:", err);
      }
    }

    // Ack to TD for VFX feedback
    touchDesignerBridge.sendGestureAck(cmd.gesture, cmd.action);

    // Log to DB
    if (this._userId) {
      supabase.from("mavis_gesture_events").update({
        action_triggered: cmd.action,
      }).eq("user_id", this._userId)
        .eq("gesture", cmd.gesture)
        .order("detected_at", { ascending: false })
        .limit(1)
        .catch(() => {/* non-fatal */});
    }

    console.info(`[GestureMapper] ${cmd.gesture} → ${cmd.action} (source: ${source})`);
  }
}

export const gestureCommandMapper = new GestureCommandMapper();

// ── Wire up systemMonitor → command mapper ────────────────────────────────────
// Any "sensor:gesture" event (from mediaPipeEngine or touchDesignerBridge)
// flows through the command mapper.

systemMonitor.on("sensor:gesture", (event: { payload?: Record<string, unknown> }) => {
  const payload = event.payload ?? {};
  const gesture = payload.gesture as GestureName | string | undefined;
  const confidence = (payload.confidence as number | undefined) ?? 1;
  const source = (payload.source as "mediapipe" | "touchdesigner" | "osc" | undefined) ?? "mediapipe";

  if (gesture && gesture !== "None") {
    gestureCommandMapper.onGesture(gesture, confidence, source).catch(() => {/* non-fatal */});
  }
});
