/**
 * TouchDesigner Bridge — Bidirectional WebSocket integration between MAVIS
 * and TouchDesigner's Web Server DAT.
 *
 * Architecture:
 *   TouchDesigner (Web Server DAT) ←→ WebSocket ←→ This bridge ←→ MAVIS
 *
 * TD → MAVIS: pose landmarks, gesture overrides, VFX state, custom OSC events
 * MAVIS → TD: agent state, voice active, emotion, gesture acknowledgements,
 *             biometric state snapshot (for reactive VFX)
 *
 * TD WebSocket DAT message formats:
 *   Inbound (TD → us):
 *     { event: "mediapipe_update", type: "pose|gesture|face", timestamp: ms, ... }
 *     { event: "td_state", data: { fps: number, opStatus: Record<string,string> } }
 *   Outbound (us → TD):
 *     { action: "mavis_state", voice_active: bool, agent_running: bool, emotion: str }
 *     { action: "gesture_ack", gesture: str, triggered_action: str }
 *     { action: "biometric_snapshot", face_present: bool, expression: str, ... }
 *
 * Reconnection: exponential backoff (3s → 6s → 12s → 24s, max 60s)
 * OSC-style: TD may also send OSC address patterns over the WebSocket as
 *   { event: "osc", address: "/hand/gesture", args: ["Thumb_Up", 0.98] }
 */

import { supabase } from "@/integrations/supabase/client";
import { systemMonitor } from "@/mavis/systemMonitor";
import { mediaPipeEngine, type BiometricState } from "@/mavis/mediaPipeEngine";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TDConfig {
  id?: string;
  name: string;
  wsHost: string;
  wsPort: number;
  wsPath: string;
  authToken?: string;
  outputTopics: string[];
  enabled: boolean;
}

export interface TDPoseLandmark {
  index: number;
  x: number; y: number; z: number;
  visibility: number;
}

export interface TDGestureData {
  left_hand?: { gesture_name: string; confidence: number; landmarks?: TDPoseLandmark[] };
  right_hand?: { gesture_name: string; confidence: number; landmarks?: TDPoseLandmark[] };
}

export interface TDMessage {
  event: string;
  type?: string;
  timestamp?: number;
  data?: Record<string, unknown>;
  // Pose event
  pose?: { landmarks: TDPoseLandmark[]; confidence: number };
  // Gesture event
  gesture?: TDGestureData;
  // Face event
  face?: { landmarks?: unknown[]; blendshapes?: Record<string, number>; confidence: number };
  // OSC passthrough
  address?: string;
  args?: unknown[];
}

export type TDConnectionStatus = "connected" | "connecting" | "disconnected" | "error";

// ── Default config (stored in localStorage) ───────────────────────────────────

const CONFIG_KEY = "mavis-td-bridge-config";

const DEFAULT_CONFIG: TDConfig = {
  name: "TouchDesigner",
  wsHost: "localhost",
  wsPort: 9980,
  wsPath: "/",
  outputTopics: ["agent_state", "voice_active", "gesture_ack", "biometric_snapshot"],
  enabled: false,
};

export function getTDConfig(): TDConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_CONFIG };
}

export function saveTDConfig(config: Partial<TDConfig>): void {
  const current = getTDConfig();
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...current, ...config }));
}

// ── OSC address pattern parser ────────────────────────────────────────────────
// Parses TD OSC-style messages forwarded over WebSocket.
// Address format: /hand/gesture, /pose/landmarks/0/x, /mavis/state/voice

interface OscMessage {
  address: string;
  args: unknown[];
}

function parseOscAddress(address: string): Record<string, string> {
  const parts = address.replace(/^\//, "").split("/");
  const parsed: Record<string, string> = {};
  parts.forEach((part, i) => { parsed[`p${i}`] = part; });
  parsed.depth = String(parts.length);
  parsed.root = parts[0] ?? "";
  parsed.leaf = parts[parts.length - 1] ?? "";
  return parsed;
}

function handleOscMessage(msg: OscMessage): Record<string, unknown> | null {
  const { address, args } = msg;
  const parsed = parseOscAddress(address);

  // /hand/gesture → gesture data
  if (parsed.root === "hand" && parsed.p1 === "gesture") {
    return { type: "gesture", name: args[0], confidence: args[1] };
  }

  // /pose/landmarks/N/channel → pose landmark component
  if (parsed.root === "pose" && parsed.p1 === "landmarks") {
    return { type: "pose_landmark", index: Number(parsed.p2), channel: parsed.p3, value: args[0] };
  }

  // /face/blendshape/name → face expression weight
  if (parsed.root === "face" && parsed.p1 === "blendshape") {
    return { type: "blendshape", name: parsed.p2, value: args[0] };
  }

  // /mavis/* → commands from TD back to MAVIS
  if (parsed.root === "mavis") {
    return { type: "command", subpath: address.slice(7), args };
  }

  return null;
}

// ── TouchDesignerBridge ───────────────────────────────────────────────────────

class TouchDesignerBridge {
  private _ws: WebSocket | null = null;
  private _status: TDConnectionStatus = "disconnected";
  private _config: TDConfig = getTDConfig();
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _reconnectDelay = 3000;
  private _listeners = new Set<(status: TDConnectionStatus) => void>();
  private _messageListeners = new Set<(msg: TDMessage) => void>();
  private _userId: string | null = null;
  private _agentRunning = false;
  private _voiceActive = false;
  private _stateFlushInterval: ReturnType<typeof setInterval> | null = null;

  get status(): TDConnectionStatus { return this._status; }
  get config(): TDConfig { return this._config; }
  get connected(): boolean { return this._status === "connected"; }

  /** Connect to TouchDesigner's Web Server DAT */
  connect(config?: Partial<TDConfig>, userId?: string): void {
    if (config) {
      this._config = { ...this._config, ...config };
      saveTDConfig(this._config);
    }
    if (userId) this._userId = userId;
    if (!this._config.enabled) return;

    this._setStatus("connecting");
    this._openSocket();
  }

  disconnect(): void {
    this._reconnectDelay = 3000; // reset backoff
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this._stateFlushInterval) clearInterval(this._stateFlushInterval);
    this._ws?.close();
    this._ws = null;
    this._setStatus("disconnected");
  }

  /** Send MAVIS state snapshot to TD for reactive VFX */
  sendMavisState(state: {
    voiceActive?: boolean;
    agentRunning?: boolean;
    emotion?: string;
    currentSpeaker?: string;
  }): void {
    if (state.voiceActive !== undefined) this._voiceActive = state.voiceActive;
    if (state.agentRunning !== undefined) this._agentRunning = state.agentRunning;
    this._send({ action: "mavis_state", ...state, timestamp: Date.now() });
  }

  /** Acknowledge that a gesture triggered a MAVIS action */
  sendGestureAck(gesture: string, triggeredAction: string): void {
    this._send({
      action: "gesture_ack",
      gesture,
      triggered_action: triggeredAction,
      timestamp: Date.now(),
    });
  }

  /** Send current biometric state snapshot to TD */
  sendBiometricSnapshot(bio: BiometricState): void {
    this._send({
      action: "biometric_snapshot",
      face_present: bio.facePresent,
      face_count: bio.faceCount,
      proximity: bio.proximity,
      expression: bio.expression,
      expression_confidence: bio.expressionConfidence,
      pose_detected: bio.poseDetected,
      engagement: bio.engagement,
      last_gesture: bio.gesture,
      timestamp: Date.now(),
    });
  }

  /** Subscribe to connection status changes */
  onStatus(fn: (status: TDConnectionStatus) => void): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Subscribe to messages from TD */
  onMessage(fn: (msg: TDMessage) => void): () => void {
    this._messageListeners.add(fn);
    return () => this._messageListeners.delete(fn);
  }

  /** Save config to DB (persists across sessions) */
  async saveToDb(userId: string): Promise<void> {
    await supabase.from("mavis_td_connections").upsert({
      user_id: userId,
      name: this._config.name,
      ws_host: this._config.wsHost,
      ws_port: this._config.wsPort,
      ws_path: this._config.wsPath,
      auth_token: this._config.authToken ?? null,
      output_topics: this._config.outputTopics,
      enabled: this._config.enabled,
      health_status: this._status === "connected" ? "connected" : "disconnected",
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,name" }).catch(() => {/* non-fatal */});
  }

  // ── WebSocket lifecycle ──────────────────────────────────────────────────

  private _openSocket(): void {
    const { wsHost, wsPort, wsPath, authToken } = this._config;
    const proto = wsHost === "localhost" || wsHost === "127.0.0.1" ? "ws" : "wss";
    let url = `${proto}://${wsHost}:${wsPort}${wsPath}`;
    if (authToken) url += `?token=${encodeURIComponent(authToken)}`;

    try {
      this._ws = new WebSocket(url);
    } catch {
      this._setStatus("error");
      this._scheduleReconnect();
      return;
    }

    this._ws.onopen = () => {
      this._setStatus("connected");
      this._reconnectDelay = 3000; // reset backoff on success

      // Persist health status
      if (this._userId) {
        supabase.from("mavis_td_connections").update({
          health_status: "connected",
          last_connected_at: new Date().toISOString(),
        }).eq("user_id", this._userId).eq("name", this._config.name)
          .catch(() => {/* non-fatal */});
      }

      systemMonitor.emit("sensor:td_connected", { host: wsHost, port: wsPort });

      // Start periodic state flush (every 2s) so TD VFX always has fresh data
      this._stateFlushInterval = setInterval(() => this._flushState(), 2000);
    };

    this._ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as TDMessage;
        this._handleInbound(msg);
      } catch {/* non-fatal */}
    };

    this._ws.onerror = () => {
      this._setStatus("error");
    };

    this._ws.onclose = () => {
      if (this._stateFlushInterval) clearInterval(this._stateFlushInterval);
      if (this._status !== "disconnected") {
        this._setStatus("disconnected");
        this._scheduleReconnect();
      }
    };
  }

  private _handleInbound(msg: TDMessage): void {
    // Notify raw message listeners
    for (const fn of this._messageListeners) {
      try { fn(msg); } catch {/* non-fatal */}
    }

    // OSC passthrough
    if (msg.event === "osc" && msg.address) {
      const oscData = handleOscMessage({ address: msg.address, args: msg.args ?? [] });
      if (oscData?.type === "gesture") {
        systemMonitor.emit("sensor:gesture", {
          gesture: oscData.name,
          confidence: oscData.confidence,
          source: "touchdesigner",
        });
      }
      return;
    }

    // TD gesture events → MAVIS systemMonitor
    if (msg.event === "mediapipe_update" || msg.event === "gesture_event") {
      if (msg.gesture?.right_hand || msg.gesture?.left_hand) {
        const hand = msg.gesture.right_hand ?? msg.gesture.left_hand!;
        systemMonitor.emit("sensor:gesture", {
          gesture: hand.gesture_name,
          confidence: hand.confidence,
          source: "touchdesigner",
        });

        // Log to DB
        if (this._userId) {
          supabase.from("mavis_gesture_events").insert({
            user_id: this._userId,
            source: "touchdesigner",
            gesture: hand.gesture_name,
            confidence: hand.confidence,
            hand: msg.gesture.right_hand ? "Right" : "Left",
            sensor_type: "gesture",
          }).catch(() => {/* non-fatal */});
        }
      }
    }

    // TD pose events → systemMonitor
    if (msg.event === "pose_update" && msg.pose) {
      systemMonitor.emit("sensor:pose", { landmarks: msg.pose.landmarks, source: "touchdesigner" });
    }
  }

  private _flushState(): void {
    if (!this.connected) return;
    const bio = mediaPipeEngine.state;
    this.sendBiometricSnapshot(bio);
    this.sendMavisState({
      voiceActive: this._voiceActive,
      agentRunning: this._agentRunning,
    });
  }

  private _send(data: Record<string, unknown>): void {
    if (!this.connected || !this._ws) return;
    try {
      this._ws.send(JSON.stringify(data));
    } catch {/* non-fatal */}
  }

  private _setStatus(status: TDConnectionStatus): void {
    this._status = status;
    for (const fn of this._listeners) {
      try { fn(status); } catch {/* non-fatal */}
    }
  }

  private _scheduleReconnect(): void {
    if (!this._config.enabled) return;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => {
      this._openSocket();
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, 60_000); // max 60s
    }, this._reconnectDelay);
  }
}

export const touchDesignerBridge = new TouchDesignerBridge();
