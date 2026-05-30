/**
 * MAVIS Wearable Overlay — ambient HUD for Meta Ray-Ban Glasses,
 * Apple visionOS 26 spatial anchors, and WebXR AR fallback.
 * Gracefully degrades when hardware/SDK is not available.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const META_GLASSES_KEY  = Deno.env.get("META_GLASSES_API_KEY") ?? "";
const META_GLASSES_BASE = "https://developers.facebook.com/docs/ray-ban-meta-smart-glasses/reference";
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SVCKEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Supabase helper ───────────────────────────────────────────────────────────

async function dbInsert(table: string, row: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "apikey":        SUPABASE_SVCKEY,
      "Authorization": `Bearer ${SUPABASE_SVCKEY}`,
      "Prefer":        "return=representation",
    },
    body: JSON.stringify(row),
  });
  return res.json();
}

// ── Meta Ray-Ban helpers ──────────────────────────────────────────────────────

function truncateForGlasses(content: string, max = 50): string {
  return content.length > max ? content.slice(0, max - 1) + "…" : content;
}

async function metaSendOverlay(body: WearableRequest) {
  const display_text = truncateForGlasses(body.content ?? "", 50);

  if (!META_GLASSES_KEY) {
    // Mock response when SDK not configured
    return {
      mock:         true,
      device:       "meta_ray_ban",
      display_text,
      overlay_type: body.overlay_type ?? "ambient",
      message:      "Meta Glasses SDK not configured — would display: " + display_text,
    };
  }

  const res = await fetch(`${META_GLASSES_BASE}/overlay/send`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${META_GLASSES_KEY}`,
    },
    body: JSON.stringify({
      text:          display_text,
      type:          body.overlay_type ?? "ambient",
      duration_ms:   body.display_duration ?? 5000,
    }),
  });

  if (!res.ok) throw new Error(`Meta Glasses API returned ${res.status}`);
  return res.json();
}

async function metaClearOverlay() {
  if (!META_GLASSES_KEY) {
    return { mock: true, device: "meta_ray_ban", message: "Meta Glasses SDK not configured — overlay cleared (mock)" };
  }

  const res = await fetch(`${META_GLASSES_BASE}/overlay/clear`, {
    method:  "POST",
    headers: { "Authorization": `Bearer ${META_GLASSES_KEY}` },
  });
  if (!res.ok) throw new Error(`Meta Glasses API returned ${res.status}`);
  return res.json();
}

async function metaGetStatus() {
  if (!META_GLASSES_KEY) {
    return { mock: true, device: "meta_ray_ban", connected: false, message: "Meta Glasses SDK not configured" };
  }

  const res = await fetch(`${META_GLASSES_BASE}/device/status`, {
    headers: { "Authorization": `Bearer ${META_GLASSES_KEY}` },
  });
  if (!res.ok) throw new Error(`Meta Glasses API returned ${res.status}`);
  return res.json();
}

// ── Apple visionOS helpers ────────────────────────────────────────────────────

function createSpatialAnchorPayload(body: WearableRequest) {
  // RealityKit coordinate system — default 0.5m in front of user
  const position = body.anchor_position ?? { x: 0, y: 0, z: -0.5 };
  return {
    id:          crypto.randomUUID(),
    device:      "vision_pro",
    anchor_type: "spatial",
    position,
    content:     body.content ?? "",
    overlay_type: body.overlay_type ?? "card",
    world_locked: true,
    realitykit: {
      entity_type:   "ModelEntity",
      mesh:          "MeshResource.generatePlane",
      material:      "SimpleMaterial",
      anchor_target:  "AnchorEntity(.world(transform: simd_float4x4))",
      instructions:  "Place at position relative to user's initial gaze on launch.",
    },
    webxr_fallback: {
      type:       "dom-overlay",
      transform:  `translate3d(${position.x * 100}vw, ${position.y * 100}vh, ${position.z * 1000}mm)`,
      content:    body.content ?? "",
    },
  };
}

// ── WebXR fallback ────────────────────────────────────────────────────────────

function createWebXRAnchor(body: WearableRequest) {
  return {
    device:     "webxr",
    anchor_id:  crypto.randomUUID(),
    content:    body.content ?? "",
    type:       body.overlay_type ?? "ambient",
    webxr: {
      frame_type:      "immersive-ar",
      anchor_type:     "plane",
      dom_overlay:     true,
      display_html:    `<div style="background:rgba(0,0,0,0.6);color:white;padding:8px;border-radius:4px;font-size:14px">${body.content ?? ""}</div>`,
      session_options: { requiredFeatures: ["dom-overlay", "anchors"], domOverlay: { root: "#ar-overlay" } },
    },
  };
}

// ── Action handlers ───────────────────────────────────────────────────────────

async function handleSendOverlay(body: WearableRequest) {
  const device = body.device_type ?? "generic";
  let result: Record<string, unknown>;

  switch (device) {
    case "meta_ray_ban":
      result = await metaSendOverlay(body);
      break;
    case "vision_pro":
      result = {
        device:      "vision_pro",
        message:     "visionOS 26 overlay queued — use spatial_anchor action for persistent placement",
        content:     truncateForGlasses(body.content ?? "", 200),
        overlay_type: body.overlay_type ?? "ambient",
      };
      break;
    default:
      // Generic / WebXR
      result = {
        ...createWebXRAnchor(body),
        message: "WebXR anchor data generated",
      };
  }

  // Log to history
  await dbInsert("wearable_overlay_history", {
    user_id:      body.user_id,
    device_type:  device,
    content:      body.content ?? "",
    overlay_type: body.overlay_type ?? "ambient",
    duration_ms:  body.display_duration ?? 5000,
  });

  return result;
}

async function handleClearOverlay(body: WearableRequest) {
  const device = body.device_type ?? "generic";
  if (device === "meta_ray_ban") return metaClearOverlay();
  return { device, message: "Overlay cleared", cleared: true };
}

async function handleGetStatus(body: WearableRequest) {
  const device = body.device_type ?? "generic";
  if (device === "meta_ray_ban") return metaGetStatus();

  return {
    device,
    connected: device !== "generic",
    battery:   null,
    message:   device === "vision_pro"
      ? "visionOS status check requires native app integration"
      : "Generic/WebXR device status",
  };
}

async function handleSendNotification(body: WearableRequest) {
  // Notifications are truncated overlays with icon hint
  const notif = {
    ...body,
    overlay_type: "notification" as const,
    content:      truncateForGlasses(body.content ?? "", 40),
  };
  return handleSendOverlay(notif);
}

function handleSpatialAnchor(body: WearableRequest) {
  const anchor = createSpatialAnchorPayload(body);
  return { ok: true, anchor };
}

// ── Request type ──────────────────────────────────────────────────────────────

interface WearableRequest {
  action:           "send_overlay" | "clear_overlay" | "get_status" | "send_notification" | "spatial_anchor";
  content?:         string;
  display_duration?: number;
  overlay_type?:    "text" | "card" | "ambient" | "notification";
  device_type?:     "meta_ray_ban" | "vision_pro" | "generic";
  anchor_position?: { x: number; y: number; z: number };
  user_id:          string;
}

// ── Entry point ───────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body: WearableRequest = await req.json();
    const { action, user_id } = body;

    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id required" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    let data: unknown;

    switch (action) {
      case "send_overlay":      data = await handleSendOverlay(body);      break;
      case "clear_overlay":     data = await handleClearOverlay(body);     break;
      case "get_status":        data = await handleGetStatus(body);        break;
      case "send_notification": data = await handleSendNotification(body); break;
      case "spatial_anchor":    data = handleSpatialAnchor(body);          break;
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true, data }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: message }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
