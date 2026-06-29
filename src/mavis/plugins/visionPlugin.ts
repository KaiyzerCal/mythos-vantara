/**
 * Vision Plugin — MAVIS integration layer for MediaPipe + TouchDesigner.
 *
 * Wraps mediaPipeEngine, touchDesignerBridge, and gestureCommandMapper into
 * a single MavisPlugin that any agent or chat can interact with.
 *
 * Actions:
 *   START_VISION_TRACKING  — request webcam + start MediaPipe inference loop
 *   STOP_VISION_TRACKING   — stop webcam, clean up resources
 *   GET_BIOMETRIC_STATE    — return current face/pose/gesture state as text
 *   MAP_GESTURE            — create/update a gesture→action command binding
 *   LIST_GESTURES          — list all current gesture command mappings
 *   CONNECT_TOUCHDESIGNER  — connect to a TouchDesigner WebSocket server
 *   DISCONNECT_TOUCHDESIGNER — disconnect from TD
 *   SEND_TD_STATE          — push arbitrary state to TD for VFX reactivity
 *
 * Provider (biometricContextProvider):
 *   Injects the current biometric state into agent system prompts so MAVIS
 *   and council members are aware of the operator's presence, expression,
 *   engagement level, and latest gesture.
 *
 * Tool registry:
 *   Registers get_biometric_state and connect_touchdesigner globally so
 *   any agent or LLM tool call can use them.
 */

import { mediaPipeEngine, buildBiometricContext } from "@/mavis/mediaPipeEngine";
import { touchDesignerBridge, getTDConfig, saveTDConfig } from "@/mavis/touchDesignerBridge";
import { gestureCommandMapper } from "@/mavis/gestureCommandMapper";
import { toolRegistry } from "@/mavis/toolRegistry";
import { storeMemory } from "@/mavis/agentMemoryEngine";
import type { MavisPlugin, MavisAction, PluginContext, ActionResult } from "@/mavis/pluginSystem";

// ── Actions ───────────────────────────────────────────────────────────────────

const START_VISION_TRACKING: MavisAction = {
  name: "START_VISION_TRACKING",
  similes: ["start vision", "enable camera", "start tracking", "start mediapipe", "turn on gesture tracking", "watch me", "use webcam"],
  description: "Start real-time webcam tracking: gesture detection, face presence, and pose engagement",
  async validate() { return true; },
  async handler(ctx): Promise<ActionResult> {
    const ok = await mediaPipeEngine.start(ctx.userId);
    if (!ok) {
      return {
        success: false,
        output: "Could not start vision tracking. Check webcam permissions and that your browser supports getUserMedia.",
        error: "Webcam unavailable",
      };
    }

    // Load user's gesture command mappings
    await gestureCommandMapper.loadUserMappings(ctx.userId);

    await storeMemory({
      agentId: ctx.agentId, agentName: ctx.agentName, agentType: "plugin",
      entityType: "experience", memoryType: "working",
      content: "Operator started vision tracking — MediaPipe gesture and presence detection is now active.",
      summary: "Vision tracking started",
      tags: ["vision", "mediapipe", "webcam"],
      wikilinks: [],
      importance: 4, confidence: 9, sourceSession: ctx.agentId,
    }, ctx.userId);

    return {
      success: true,
      output: "Vision tracking active. I can now detect your gestures, presence, expression, and engagement level. Gesture commands are loaded.",
      data: { tracking: true, gestureCommands: gestureCommandMapper.listCommands().length },
    };
  },
};

const STOP_VISION_TRACKING: MavisAction = {
  name: "STOP_VISION_TRACKING",
  similes: ["stop vision", "disable camera", "stop tracking", "stop mediapipe", "turn off gesture tracking"],
  description: "Stop webcam tracking and release all camera resources",
  async validate() { return true; },
  async handler(): Promise<ActionResult> {
    mediaPipeEngine.stop();
    return {
      success: true,
      output: "Vision tracking stopped. Webcam released.",
      data: { tracking: false },
    };
  },
};

const GET_BIOMETRIC_STATE: MavisAction = {
  name: "GET_BIOMETRIC_STATE",
  similes: ["biometric", "how am i looking", "my state", "read my expression", "detect my mood", "can you see me", "what gesture am i making"],
  description: "Return a summary of the operator's current biometric state from webcam",
  async validate() { return true; },
  async handler(): Promise<ActionResult> {
    const state = mediaPipeEngine.state;
    if (!mediaPipeEngine.running) {
      return {
        success: false,
        output: "Vision tracking is not active. Use START_VISION_TRACKING first.",
        error: "Not running",
      };
    }

    const context = buildBiometricContext(state);
    if (!context) {
      return { success: true, output: "No biometric data captured yet. Make sure you're visible to the webcam.", data: state };
    }

    const output = [
      context,
      state.gesture !== "None"
        ? `\nActive gesture: **${state.gesture}** (${Math.round(state.gestureConfidence * 100)}% confidence, ${state.gestureHand} hand)`
        : "\nNo gesture currently detected.",
    ].join("");

    return { success: true, output, data: state };
  },
};

const MAP_GESTURE: MavisAction = {
  name: "MAP_GESTURE",
  similes: ["map gesture", "set gesture command", "assign gesture", "bind gesture", "gesture shortcut"],
  description: "Map a gesture to a MAVIS action. Input: 'Thumb_Up → approve:pending_op [hold:300ms]'",
  async validate(_ctx, input) { return input.includes("→") || input.includes("->"); },
  async handler(ctx, input): Promise<ActionResult> {
    // Parse: "Gesture → action [hold:Nms] [label: text]"
    const normalized = input.replace("->", "→");
    const [gesturePart, rest] = normalized.split("→").map(s => s.trim());
    if (!gesturePart || !rest) {
      return { success: false, output: "Format: GestureName → action [hold:300ms]", error: "Parse error" };
    }

    const holdMatch = rest.match(/hold:(\d+)ms/i);
    const holdMs = holdMatch ? parseInt(holdMatch[1]) : 0;
    const actionStr = rest.replace(/hold:\d+ms/i, "").trim();

    await gestureCommandMapper.saveCommand({
      gesture: gesturePart,
      action: actionStr as import("@/mavis/gestureCommandMapper").GestureAction,
      label: `${gesturePart} → ${actionStr}`,
      holdMs,
      enabled: true,
    });

    return {
      success: true,
      output: `Gesture mapped: **${gesturePart}** → ${actionStr}${holdMs > 0 ? ` (hold ${holdMs}ms)` : ""}`,
      data: { gesture: gesturePart, action: actionStr, holdMs },
    };
  },
};

const LIST_GESTURES: MavisAction = {
  name: "LIST_GESTURES",
  similes: ["list gestures", "show gesture commands", "what gestures", "gesture mappings"],
  description: "List all current gesture→action command mappings",
  async validate() { return true; },
  async handler(): Promise<ActionResult> {
    const cmds = gestureCommandMapper.listCommands();
    const output = cmds
      .filter(c => c.enabled)
      .map(c => `• **${c.gesture}**${c.holdMs > 0 ? ` (hold ${c.holdMs}ms)` : ""} → ${c.action}\n  ${c.label}`)
      .join("\n");

    return {
      success: true,
      output: `Gesture command bindings (${cmds.filter(c => c.enabled).length} active):\n\n${output || "No mappings configured."}`,
      data: cmds,
    };
  },
};

const CONNECT_TOUCHDESIGNER: MavisAction = {
  name: "CONNECT_TOUCHDESIGNER",
  similes: ["connect touchdesigner", "connect td", "connect to touchdesigner", "link touchdesigner", "td bridge"],
  description: "Connect to a TouchDesigner WebSocket server. Input: 'ws://localhost:9980' or 'host:port'",
  async validate(_ctx, input) { return input.trim().length > 2; },
  async handler(ctx, input): Promise<ActionResult> {
    // Parse host:port or full ws:// URL
    let host = "localhost";
    let port = 9980;

    const wsMatch = input.match(/ws:\/\/([^:/]+):?(\d+)?/);
    if (wsMatch) {
      host = wsMatch[1];
      port = wsMatch[2] ? parseInt(wsMatch[2]) : 9980;
    } else {
      const hostPort = input.trim().split(":");
      if (hostPort[0]) host = hostPort[0];
      if (hostPort[1]) port = parseInt(hostPort[1]);
    }

    saveTDConfig({ wsHost: host, wsPort: port, enabled: true });
    touchDesignerBridge.connect({ wsHost: host, wsPort: port, enabled: true }, ctx.userId);

    // Wait up to 3s for connection
    await new Promise(resolve => setTimeout(resolve, 3000));
    const connected = touchDesignerBridge.connected;

    if (connected) {
      await touchDesignerBridge.saveToDb(ctx.userId);
    }

    return {
      success: connected,
      output: connected
        ? `Connected to TouchDesigner at ${host}:${port}. MAVIS will now stream biometric state and receive TD gesture/pose data.`
        : `Could not connect to TouchDesigner at ${host}:${port}. Make sure TD is running with a Web Server DAT on port ${port}.`,
      data: { host, port, connected },
    };
  },
};

const DISCONNECT_TOUCHDESIGNER: MavisAction = {
  name: "DISCONNECT_TOUCHDESIGNER",
  similes: ["disconnect touchdesigner", "disconnect td", "stop td bridge"],
  description: "Disconnect from TouchDesigner WebSocket server",
  async validate() { return true; },
  async handler(): Promise<ActionResult> {
    touchDesignerBridge.disconnect();
    saveTDConfig({ enabled: false });
    return { success: true, output: "Disconnected from TouchDesigner.", data: { connected: false } };
  },
};

const SEND_TD_STATE: MavisAction = {
  name: "SEND_TD_STATE",
  similes: ["send to td", "push state to touchdesigner", "update td visuals", "tell touchdesigner"],
  description: "Push a state update to TouchDesigner for reactive VFX. Input: 'emotion=focus speaker=MAVIS'",
  async validate() { return true; },
  async handler(_ctx, input): Promise<ActionResult> {
    if (!touchDesignerBridge.connected) {
      return { success: false, output: "Not connected to TouchDesigner. Use CONNECT_TOUCHDESIGNER first.", error: "Not connected" };
    }

    // Parse simple key=value pairs
    const pairs: Record<string, string> = {};
    for (const match of input.matchAll(/(\w+)=(\S+)/g)) {
      pairs[match[1]] = match[2];
    }

    touchDesignerBridge.sendMavisState({
      emotion: pairs.emotion,
      currentSpeaker: pairs.speaker,
      voiceActive: pairs.voice === "true",
      agentRunning: pairs.agent === "true",
    });

    return {
      success: true,
      output: `State pushed to TouchDesigner: ${Object.entries(pairs).map(([k, v]) => `${k}=${v}`).join(", ")}`,
      data: pairs,
    };
  },
};

// ── Provider — biometric context in agent prompts ─────────────────────────────

const biometricContextProvider = {
  name: "BiometricContext",
  description: "Injects real-time biometric state (presence, expression, gesture, engagement) into agent prompts",
  async get(_ctx: PluginContext): Promise<string> {
    if (!mediaPipeEngine.running) return "";
    return buildBiometricContext(mediaPipeEngine.state);
  },
};

// ── Tool registry integration ─────────────────────────────────────────────────

toolRegistry.register({
  name: "get_biometric_state",
  description: "Get current operator biometric state from webcam: gesture, face presence, expression, engagement",
  category: "analysis",
  parameters: { type: "object", properties: {} },
  async execute() {
    const state = mediaPipeEngine.state;
    if (!mediaPipeEngine.running) {
      return { success: false, output: "Vision tracking not active", error: "Not running" };
    }
    const context = buildBiometricContext(state);
    return { success: true, output: context || "No biometric data yet", data: state };
  },
});

toolRegistry.register({
  name: "connect_touchdesigner",
  description: "Connect to a TouchDesigner WebSocket server for bidirectional VFX integration",
  category: "api",
  parameters: {
    type: "object",
    properties: {
      host: { type: "string", description: "TD server hostname (default: localhost)" },
      port: { type: "number", description: "TD WebSocket port (default: 9980)" },
    },
  },
  async execute(params, userId) {
    if (!userId) return { success: false, output: "", error: "userId required" };
    const host = (params.host as string) ?? "localhost";
    const port = (params.port as number) ?? 9980;
    saveTDConfig({ wsHost: host, wsPort: port, enabled: true });
    touchDesignerBridge.connect({ wsHost: host, wsPort: port, enabled: true }, userId);
    await new Promise(resolve => setTimeout(resolve, 3000));
    const connected = touchDesignerBridge.connected;
    return {
      success: connected,
      output: connected ? `Connected to TD at ${host}:${port}` : `Failed to connect to TD at ${host}:${port}`,
      data: { host, port, connected },
    };
  },
});

toolRegistry.register({
  name: "map_gesture",
  description: "Map a hand gesture to a MAVIS action command",
  category: "analysis",
  parameters: {
    type: "object",
    properties: {
      gesture: { type: "string", description: "Gesture name (e.g. Thumb_Up, Open_Palm, Victory)" },
      action: { type: "string", description: "MAVIS action to trigger (e.g. voice:toggle, approve:pending_op)" },
      hold_ms: { type: "number", description: "Hold duration in ms before triggering (0 = instant)" },
    },
    required: ["gesture", "action"],
  },
  async execute(params, userId) {
    if (!userId) return { success: false, output: "", error: "userId required" };
    await gestureCommandMapper.loadUserMappings(userId);
    await gestureCommandMapper.saveCommand({
      gesture: params.gesture as string,
      action: params.action as import("@/mavis/gestureCommandMapper").GestureAction,
      label: `${params.gesture} → ${params.action}`,
      holdMs: (params.hold_ms as number) ?? 0,
      enabled: true,
    });
    return {
      success: true,
      output: `Mapped: ${params.gesture} → ${params.action}`,
      data: { gesture: params.gesture, action: params.action },
    };
  },
});

// ── Plugin export ─────────────────────────────────────────────────────────────

export const visionPlugin: MavisPlugin = {
  name: "vision-mediapipe-td",
  version: "1.0.0",
  description: "Real-time vision tracking — MediaPipe gesture/presence detection + TouchDesigner VFX bridge",
  author: "MAVIS",
  capabilities: ["inference", "tool", "sensor", "biometric", "visualization"],
  requiredScopes: ["camera"],
  actions: [
    START_VISION_TRACKING,
    STOP_VISION_TRACKING,
    GET_BIOMETRIC_STATE,
    MAP_GESTURE,
    LIST_GESTURES,
    CONNECT_TOUCHDESIGNER,
    DISCONNECT_TOUCHDESIGNER,
    SEND_TD_STATE,
  ],
  providers: [biometricContextProvider],
  evaluators: [],
  async onEnable() {
    // Auto-connect TD if config is saved and enabled
    const cfg = getTDConfig();
    if (cfg.enabled) {
      touchDesignerBridge.connect(cfg);
    }
  },
  async onDisable() {
    mediaPipeEngine.stop();
    touchDesignerBridge.disconnect();
  },
};
